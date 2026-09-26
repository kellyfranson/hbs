#!/usr/bin/env node
/**
 * Download every course file from Canvas into a local folder tree.
 *
 * Mirrors each course's Files area: <out>/<COURSE_CODE>/<folder path>/<file>.
 * Re-running skips files already on disk at the right size, so an interrupted
 * run resumes where it stopped.
 *
 *   node scripts/download-material.mjs --dry-run
 *   node scripts/download-material.mjs --out "D:/HBS"
 *   node scripts/download-material.mjs --course FIN1-I --course LEAD-I
 *   node scripts/download-material.mjs --max-mb 50        # skip huge videos
 *
 * Standalone on purpose: this is a CLI utility, not part of the Next app, so
 * it reads .env.local itself rather than importing the app's TypeScript.
 */

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const DEFAULT_OUT = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  "Downloads",
  "HBS Course Material",
);
const CONCURRENCY = 5;
const TIMEOUT_MS = 120_000;

/* ----------------------------- arguments ----------------------------- */

function parseArgs(argv) {
  const args = {
    dryRun: false,
    out: DEFAULT_OUT,
    courses: [],
    term: "current",
    maxBytes: Infinity,
    /** Empty means every type. */
    exts: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--course") args.courses.push(argv[++i]);
    else if (arg === "--term") args.term = argv[++i];
    else if (arg === "--max-mb") args.maxBytes = Number(argv[++i]) * 1024 * 1024;
    else if (arg === "--ext") {
      args.exts.push(...argv[++i].split(",").map((e) => e.replace(/^\./, "").toLowerCase()));
    }
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

/* ------------------------------- canvas ------------------------------- */

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) {
    console.error("No .env.local found. Run this from the project root.");
    process.exit(2);
  }

  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }

  if (!env.CANVAS_TOKEN) {
    console.error("CANVAS_TOKEN is empty in .env.local.");
    process.exit(2);
  }
  return {
    token: env.CANVAS_TOKEN,
    base: (env.CANVAS_BASE_URL || "https://hbs.instructure.com").replace(/\/+$/, ""),
  };
}

function nextPageUrl(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?([^"\s;]+)"?/);
    if (m && m[2] === "next") return m[1];
  }
  return null;
}

async function paginate(url, token) {
  const items = [];
  let next = url;

  while (next) {
    const res = await fetch(next, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A disabled course feature answers 404/403; that is absence, not failure.
    if (res.status === 404 || res.status === 403) return items;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${next}`);

    const payload = await res.json();
    if (!Array.isArray(payload)) return items;
    items.push(...payload);
    next = nextPageUrl(res.headers.get("link"));
  }
  return items;
}

function isCurrentTerm(course, now) {
  const start = course.term?.start_at ? new Date(course.term.start_at) : null;
  const end = course.term?.end_at ? new Date(course.term.end_at) : null;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

/* -------------------------------- paths -------------------------------- */

/** Windows forbids <>:"/\|?* and trailing dots or spaces in a path segment. */
function safeSegment(name) {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/[. ]+$/, "")
      .slice(0, 120) || "untitled"
  );
}

function safePath(folderPath) {
  return folderPath
    .replace(/^course files\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(safeSegment);
}

/**
 * Does this file match one of the wanted extensions?
 *
 * Canvas filenames like "03. Course Requirements Memo FA26" carry a dot but no
 * real extension, so the MIME type Canvas reports is checked as well. It is
 * spelled with a hyphen, which is why it needs bracket access.
 */
function matchesExt(name, file, exts) {
  const ext = path.extname(name).replace(/^\./, "").toLowerCase();
  if (exts.includes(ext)) return true;

  const mime = (file["content-type"] || file.content_type || "").toLowerCase();
  return exts.some((e) => MIME_BY_EXT[e] === mime);
}

const MIME_BY_EXT = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function formatBytes(bytes) {
  if (!bytes) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n.toFixed(n < 10 && u > 0 ? 1 : 0)} ${units[u]}`;
}

/* ------------------------------ downloading ------------------------------ */

async function downloadOne(file, token) {
  fs.mkdirSync(path.dirname(file.dest), { recursive: true });

  // `file.url` is a pre-signed, short-lived link and needs no auth header;
  // fall back to the authenticated endpoint if Canvas omitted it.
  const res = await fetch(file.url || file.apiUrl, {
    headers: file.url ? {} : { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  // Write to a temp name first so an interrupted run never leaves a truncated
  // file that the next run would mistake for complete.
  const tmp = `${file.dest}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, file.dest);
}

async function runPool(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await worker(items[i], i);
    }
  });
  await Promise.all(workers);
}

/* --------------------------------- main --------------------------------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { token, base } = loadEnv();
  const now = new Date();

  let courses = await paginate(
    `${base}/api/v1/courses?enrollment_state=active&include[]=term&per_page=100`,
    token,
  );
  courses = courses.filter((c) => c.id && !c.access_restricted_by_date);
  if (args.term !== "all") courses = courses.filter((c) => isCurrentTerm(c, now));
  if (args.courses.length) {
    courses = courses.filter((c) => args.courses.includes(c.course_code));
  }

  if (!courses.length) {
    console.error("No matching courses.");
    process.exit(1);
  }

  const planned = [];
  const skippedLarge = [];
  const hbspByCourse = {};

  for (const course of courses) {
    const code = safeSegment(course.course_code || String(course.id));
    const [files, folders, assignments] = await Promise.all([
      paginate(`${base}/api/v1/courses/${course.id}/files?per_page=100`, token),
      paginate(`${base}/api/v1/courses/${course.id}/folders?per_page=100`, token),
      paginate(`${base}/api/v1/courses/${course.id}/assignments?per_page=100`, token),
    ]);

    const folderById = new Map(folders.map((f) => [f.id, f.full_name || ""]));
    const inFilesArea = new Set(files.map((f) => f.id));

    // Some files are linked from an assignment description but never appear in
    // the course Files listing, so walking Files alone quietly misses them.
    const extra = [];
    const anchor = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    for (const a of assignments) {
      for (const m of (a.description || "").matchAll(anchor)) {
        const href = m[1].replace(/&amp;/g, "&");
        const label = m[2].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

        if (/hbsp\.harvard\.edu/.test(href)) {
          (hbspByCourse[code] ??= []).push({
            assignment: a.name || "",
            due: a.due_at || "",
            label: label || href,
            url: href,
          });
          continue;
        }
        const fm = href.match(/\/courses\/\d+\/files\/(\d+)/);
        if (!fm) continue;
        const id = Number(fm[1]);
        if (inFilesArea.has(id) || extra.some((e) => e.id === id)) continue;
        extra.push({ id, assignment: a.name || "" });
      }
    }

    const linked = await Promise.all(
      extra.map(async (e) => {
        const res = await fetch(`${base}/api/v1/files/${e.id}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // A file can be linked from a description and still be restricted.
        if (!res.ok) return null;
        const file = await res.json();
        // No folder of its own: file it under the assignment that links it.
        return {
          ...file,
          folder_id: undefined,
          __folder: "Linked from assignments",
          __linked: true,
        };
      }),
    );

    for (const file of [...files, ...linked.filter(Boolean)]) {
      // `hidden` means "not listed in the Files tab", which is exactly why a
      // linked file was missing from it — so for those it is expected, not a
      // reason to skip. `locked_for_user` is a real access restriction.
      if (file.locked_for_user) continue;
      if (file.hidden && !file.__linked) continue;

      const raw = file.display_name || file.filename || `file-${file.id}`;
      if (args.exts.length && !matchesExt(raw, file, args.exts)) continue;

      const name = safeSegment(raw);
      const dest = path.join(
        args.out,
        code,
        ...safePath(file.__folder || folderById.get(file.folder_id) || ""),
        name,
      );

      const entry = {
        dest,
        url: file.url,
        apiUrl: `${base}/api/v1/files/${file.id}/public_url`,
        size: file.size || 0,
        label: `${code}/${name}`,
      };

      if (entry.size > args.maxBytes) {
        skippedLarge.push(entry);
        continue;
      }
      planned.push(entry);
    }
  }

  const existing = planned.filter(
    (f) => fs.existsSync(f.dest) && (!f.size || fs.statSync(f.dest).size === f.size),
  );
  const todo = planned.filter((f) => !existing.includes(f));
  const totalBytes = todo.reduce((sum, f) => sum + f.size, 0);

  console.log(`Courses:   ${courses.map((c) => c.course_code).join(", ")}`);
  console.log(`Files:     ${planned.length} found, ${existing.length} already on disk`);
  console.log(`To fetch:  ${todo.length} files, ${formatBytes(totalBytes)}`);
  if (skippedLarge.length) {
    const big = skippedLarge.reduce((s, f) => s + f.size, 0);
    console.log(`Skipped:   ${skippedLarge.length} over --max-mb (${formatBytes(big)})`);
  }
  console.log(`Into:      ${args.out}`);

  if (args.dryRun) {
    console.log("\n(dry run — nothing downloaded)");
    const byCourse = {};
    for (const f of todo) {
      const c = f.label.split("/")[0];
      byCourse[c] = (byCourse[c] || { n: 0, b: 0 });
      byCourse[c].n++;
      byCourse[c].b += f.size;
    }
    for (const [c, v] of Object.entries(byCourse)) {
      console.log(`  ${c.padEnd(10)} ${String(v.n).padStart(4)} files  ${formatBytes(v.b)}`);
    }
    return;
  }

  if (!todo.length) {
    console.log("\nNo files to fetch.");
    writeCaseIndex(hbspByCourse, args.out);
    return;
  }

  console.log("");
  let done = 0;
  const failures = [];

  await runPool(todo, CONCURRENCY, async (file) => {
    try {
      await downloadOne(file, token);
      done++;
      process.stdout.write(`\r  ${done}/${todo.length}  ${file.label.slice(0, 60)}`.padEnd(90));
    } catch (error) {
      failures.push({ file: file.label, reason: String(error.message || error) });
    }
  });

  console.log(`\n\nDownloaded ${done} of ${todo.length} files into ${args.out}`);
  for (const f of failures) console.error(`  failed: ${f.file} — ${f.reason}`);

  writeCaseIndex(hbspByCourse, args.out);

  if (failures.length) process.exitCode = 1;
}

/**
 * Write an index of the Harvard Business Publishing links.
 *
 * The cases themselves are not in Canvas and cannot be downloaded: they sit in
 * an HBP coursepack behind your own login. The next best thing is a per-class
 * index sitting next to the files that could be fetched.
 */
function writeCaseIndex(hbspByCourse, out) {
  const courses = Object.entries(hbspByCourse).filter(([, v]) => v.length);
  if (!courses.length) return;

  const lines = [
    "# Cases and readings on Harvard Business Publishing",
    "",
    "These are not stored in Canvas, so they cannot be downloaded here.",
    "Each link opens in HBP against your own login.",
    "",
  ];

  let count = 0;
  for (const [code, links] of courses.sort()) {
    lines.push(`## ${code}`, "");
    const byAssignment = new Map();
    for (const l of links) {
      if (!byAssignment.has(l.assignment)) byAssignment.set(l.assignment, { due: l.due, items: new Map() });
      byAssignment.get(l.assignment).items.set(l.url, l.label);
    }
    const sorted = [...byAssignment].sort((a, b) => (a[1].due || "9999").localeCompare(b[1].due || "9999"));
    for (const [assignment, { due, items }] of sorted) {
      lines.push(`### ${assignment}${due ? `  _(due ${due.slice(0, 10)})_` : ""}`);
      for (const [url, label] of items) {
        lines.push(`- [${label}](${url})`);
        count++;
      }
      lines.push("");
    }
  }

  const dest = path.join(out, "CASES-on-HBP.md");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(dest, lines.join("\n"), "utf8");
  console.log(`\nWrote ${count} HBP case/reading links to ${dest}`);
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  process.exit(1);
});
