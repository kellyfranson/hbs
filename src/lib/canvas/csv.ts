import type { AssignmentRow, MaterialRow } from "./types";

const COLUMNS = [
  "kind",
  "course",
  "course_code",
  "term",
  "module",
  "title",
  "due_local",
  "due_utc",
  "days_until",
  "points",
  "submitted",
  "submission_type",
  "url",
] as const;

/**
 * Quote a CSV field.
 *
 * Course names carry commas ("Finance I, Section A") and the occasional
 * quote, so every field is quoted and inner quotes are doubled per RFC 4180.
 */
function escape(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function formatLocal(iso: string | null, timeZone: string): string {
  if (!iso) return "";

  // en-CA with a 24-hour clock gives "2026-09-28 08:40", which reads fine and
  // still sorts correctly as text in Excel.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(",", "");
}

export function daysUntil(iso: string | null, from: Date = new Date()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - from.getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * One CSV covering both passes.
 *
 * Assignments and course material share a file so you get a single sheet to
 * sort and filter; the `kind` column is what tells them apart.
 */
export function toCsv(
  rows: AssignmentRow[],
  timeZone: string,
  material: MaterialRow[] = [],
): string {
  const now = new Date();

  // Each assignment is followed by its cases and readings, which carry the
  // parent's due date so the sheet still sorts into a usable reading schedule.
  const assignmentLines = rows.flatMap((row) => [
    [
      "assignment",
      row.course,
      row.courseCode,
      row.term,
      "",
      row.assignment,
      formatLocal(row.dueAt, timeZone),
      row.dueAt ?? "",
      daysUntil(row.dueAt, now),
      row.points,
      row.submitted ? "yes" : "no",
      row.submissionTypes.join(", "),
      row.url,
    ]
      .map(escape)
      .join(","),
    ...row.links.map((link) =>
      [
        link.kind === "hbsp" ? "case-or-reading" : `linked-${link.kind}`,
        row.course,
        row.courseCode,
        row.term,
        row.assignment,
        link.label,
        formatLocal(row.dueAt, timeZone),
        row.dueAt ?? "",
        daysUntil(row.dueAt, now),
        "",
        "",
        "",
        link.url,
      ]
        .map(escape)
        .join(","),
    ),
  ]);

  const materialLines = material.map((row) =>
    [
      row.kind,
      row.course,
      row.courseCode,
      "",
      row.module,
      row.title,
      formatLocal(row.dueAt, timeZone),
      row.dueAt ?? "",
      daysUntil(row.dueAt, now),
      "",
      "",
      "",
      row.url,
    ]
      .map(escape)
      .join(","),
  );

  // Excel needs CRLF to treat embedded newlines in quoted fields correctly.
  return (
    [COLUMNS.join(","), ...assignmentLines, ...materialLines].join("\r\n") +
    "\r\n"
  );
}
