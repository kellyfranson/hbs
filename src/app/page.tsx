import { Suspense } from "react";
import Link from "next/link";
import { getAssignmentRows, getMaterialRows } from "@/lib/canvas/client";
import { daysUntil, formatLocal } from "@/lib/canvas/csv";
import {
  isBucket,
  type AssignmentRow,
  type AssignmentsQuery,
  type MaterialRow,
  type SkippedCourse,
} from "@/lib/canvas/types";

/** Term dates and due dates are only meaningful in the school's timezone. */
const TIME_ZONE = process.env.CANVAS_TZ ?? "America/New_York";

const FILTERS = [
  { label: "Upcoming", query: "bucket=upcoming" },
  { label: "Unsubmitted", query: "bucket=unsubmitted" },
  { label: "Overdue", query: "bucket=overdue" },
  { label: "All this term", query: "" },
  { label: "All terms", query: "term=all" },
];

type Params = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: PageProps<"/">) {
  const params = await searchParams;

  if (!process.env.CANVAS_TOKEN) {
    return <SetupNotice />;
  }

  const query = toQuery(params);
  const withMaterial = first(params.material) === "1";
  const search = flatten(params);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="font-mono text-2xl font-bold tracking-tight text-[#A51C30]">
          HBS ASSIGNMENTS
        </h1>
      </header>

      <nav className="mb-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => (
          <Pill key={filter.label} href={withParam(search, filter.query)}>
            {filter.label}
          </Pill>
        ))}
        <span className="grow" />
        <Pill href={withParam(search, "refresh=1")}>Refresh</Pill>
        <a
          href={`/api/assignments?format=csv&${search}`}
          className="rounded-full bg-[#A51C30] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#8a1728]"
        >
          Download CSV
        </a>
      </nav>

      {/*
        Each pass streams on its own. The material pass costs three extra
        requests per course, so blocking the assignment table behind it would
        make the common case feel slow.
      */}
      <Suspense fallback={<TableSkeleton />}>
        <AssignmentSection query={query} />
      </Suspense>

      <section className="mt-12 border-t border-stone-200 pt-8 dark:border-stone-800">
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-stone-600 dark:text-stone-400">
          Course material
        </h2>
        <p className="mt-1 text-xs text-stone-500">
          Cases, notes and readings from Modules and Pages that Canvas does not
          model as assignments. Anything already in the table above is left out.
        </p>

        {withMaterial ? (
          <Suspense fallback={<TableSkeleton />}>
            <MaterialSection query={query} />
          </Suspense>
        ) : (
          <Pill
            href={withParam(search, "material=1")}
            className="mt-4 inline-block"
          >
            Load course material
          </Pill>
        )}
      </section>
    </main>
  );
}

async function AssignmentSection({ query }: { query: AssignmentsQuery }) {
  const { rows, courseCount, skipped, fetchedAt } =
    await getAssignmentRows(query);
  const now = new Date(fetchedAt);

  return (
    <>
      <p className="mb-4 text-sm text-stone-500">
        {rows.length} assignment{rows.length === 1 ? "" : "s"} across{" "}
        {courseCount} course{courseCount === 1 ? "" : "s"} &middot; as of{" "}
        {formatLocal(fetchedAt, TIME_ZONE)}
      </p>

      <SkippedNotice skipped={skipped} />

      {rows.length === 0 ? (
        <Empty />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-300 text-left text-xs uppercase tracking-wider text-stone-500 dark:border-stone-700">
              <th className="py-2 pr-3 font-medium">Due</th>
              <th className="py-2 pr-3 font-medium">Course</th>
              <th className="py-2 pr-3 font-medium">Assignment</th>
              <th className="py-2 pr-3 text-right font-medium">Pts</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AssignmentRowView key={`${row.courseId}-${row.url}`} row={row} now={now} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function AssignmentRowView({ row, now }: { row: AssignmentRow; now: Date }) {
  const days = daysUntil(row.dueAt, now);
  const overdue = days !== null && days < 0 && !row.submitted;
  const soon = days !== null && days >= 0 && days <= 2;

  return (
    <tr className="border-b border-stone-200 align-top dark:border-stone-800">
      <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs">
        <span className={overdue ? "text-[#A51C30]" : soon ? "text-amber-600" : ""}>
          {row.dueAt ? formatLocal(row.dueAt, TIME_ZONE) : "no due date"}
        </span>
        {days !== null && (
          <span className="block text-stone-500">
            {days === 0 ? "today" : days > 0 ? `in ${days}d` : `${-days}d ago`}
          </span>
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-stone-600 dark:text-stone-400">
        {row.courseCode || row.course}
      </td>
      <td className="py-2 pr-3">
        <ExternalLink href={row.url}>{row.assignment}</ExternalLink>
      </td>
      <td className="py-2 pr-3 text-right font-mono text-xs text-stone-500">
        {row.points ?? "—"}
      </td>
      <td className="py-2 text-xs">
        {row.submitted ? (
          <span className="text-emerald-600">submitted</span>
        ) : (
          <span className="text-stone-500">—</span>
        )}
      </td>
    </tr>
  );
}

async function MaterialSection({ query }: { query: AssignmentsQuery }) {
  const { material, skipped } = await getMaterialRows(query);

  if (material.length === 0) {
    return (
      <p className="mt-4 text-sm text-stone-500">
        Nothing in Modules or Pages beyond what is already listed above.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <p className="mb-4 text-sm text-stone-500">
        {material.length} item{material.length === 1 ? "" : "s"}
      </p>

      {/* The assignment pass reports the same unreadable courses, so this one
          says which endpoint it is talking about. */}
      <SkippedNotice skipped={skipped} label="Could not read Modules/Pages for" />

      {groupByCourse(material).map(([course, modules]) => (
        <div key={course} className="mb-6">
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-[#A51C30]">
            {course}
          </h3>
          {modules.map(([moduleName, items]) => (
            <div key={moduleName} className="mb-3 pl-3">
              {moduleName && (
                <p className="text-xs font-medium text-stone-600 dark:text-stone-400">
                  {moduleName}
                </p>
              )}
              <ul className="mt-1">
                {items.map((item) => (
                  <li
                    key={item.url}
                    className="flex items-baseline gap-2 border-b border-stone-100 py-1 text-sm dark:border-stone-900"
                  >
                    <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-stone-400">
                      {item.kind}
                    </span>
                    <ExternalLink href={item.url}>{item.title}</ExternalLink>
                    {item.dueAt && (
                      <span className="font-mono text-xs text-amber-600">
                        {formatLocal(item.dueAt, TIME_ZONE)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Course -> module -> items, preserving the order Canvas returned. */
function groupByCourse(
  material: MaterialRow[],
): [string, [string, MaterialRow[]][]][] {
  const byCourse = new Map<string, Map<string, MaterialRow[]>>();

  for (const row of material) {
    const courseKey = row.courseCode || row.course;
    const modules = byCourse.get(courseKey) ?? new Map();
    byCourse.set(courseKey, modules);
    modules.set(row.module, [...(modules.get(row.module) ?? []), row]);
  }

  return [...byCourse].map(([course, modules]) => [course, [...modules]]);
}

function SkippedNotice({
  skipped,
  label = "Skipped",
}: {
  skipped: SkippedCourse[];
  label?: string;
}) {
  if (skipped.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <p className="font-medium">
        {label} {skipped.length} course{skipped.length === 1 ? "" : "s"}:
      </p>
      <ul className="mt-1 list-inside list-disc">
        {skipped.map((entry) => (
          <li key={`${entry.course}-${entry.reason}`}>
            {entry.course} &mdash; {entry.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-[#A51C30] hover:underline"
    >
      {children}
    </a>
  );
}

function Pill({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border border-stone-300 px-3 py-1 text-xs font-medium transition hover:border-[#A51C30] hover:text-[#A51C30] dark:border-stone-700 ${className}`}
    >
      {children}
    </Link>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-9 animate-pulse rounded bg-stone-200 dark:bg-stone-800"
        />
      ))}
    </div>
  );
}

function Empty() {
  return (
    <p className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 dark:border-stone-700">
      Nothing here. Try{" "}
      <Link href="?" className="underline">
        all of this term
      </Link>{" "}
      or{" "}
      <Link href="?undated=1" className="underline">
        include undated assignments
      </Link>
      .
    </p>
  );
}

function SetupNotice() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-mono text-2xl font-bold text-[#A51C30]">Setup needed</h1>
      <p className="mt-4 text-sm">
        Create a Canvas access token at{" "}
        <code className="rounded bg-stone-200 px-1 py-0.5 text-xs dark:bg-stone-800">
          /profile/settings
        </code>{" "}
        &rarr; <strong>New Access Token</strong>, then add it to{" "}
        <code className="rounded bg-stone-200 px-1 py-0.5 text-xs dark:bg-stone-800">
          .env.local
        </code>
        :
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-stone-900 p-4 font-mono text-xs text-stone-100">
        CANVAS_TOKEN=your_token_here{"\n"}
        CANVAS_BASE_URL=https://hbs.instructure.com
      </pre>
      <p className="mt-4 text-sm text-stone-500">
        Restart the dev server afterwards so Next.js picks up the new value.
      </p>
    </main>
  );
}

function toQuery(params: Params): AssignmentsQuery {
  const bucket = first(params.bucket);

  return {
    term: first(params.term) === "all" ? "all" : "current",
    bucket: isBucket(bucket) ? bucket : undefined,
    undated: first(params.undated) === "1",
    revalidate: first(params.refresh) === "1" ? 0 : undefined,
  };
}

/** A repeated query param arrives as an array; take the first value. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function flatten(params: Params): string {
  return new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => {
      const single = first(value);
      // `refresh` is a one-shot action, not a filter to carry between clicks.
      return single && key !== "refresh" ? [[key, single] as [string, string]] : [];
    }),
  ).toString();
}

/**
 * Add or replace one `key=value` in the current search, so clicking a filter
 * keeps whatever else is already set (notably `material=1`).
 */
function withParam(search: string, pair: string): string {
  const next = new URLSearchParams(search);
  const [key, value] = pair.split("=");

  if (!key) {
    // "All this term" clears the bucket and term filters but keeps the rest.
    next.delete("bucket");
    next.delete("term");
  } else if (key === "bucket") {
    next.delete("term");
    next.set(key, value);
  } else if (key === "term") {
    next.delete("bucket");
    next.set(key, value);
  } else {
    next.set(key, value);
  }

  const qs = next.toString();
  return qs ? `?${qs}` : "?";
}
