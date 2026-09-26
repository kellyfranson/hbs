import Link from "next/link";
import { getAssignmentRows } from "@/lib/canvas/client";
import { daysUntil, formatLocal } from "@/lib/canvas/csv";
import { isBucket, type AssignmentRow } from "@/lib/canvas/types";

/** Term dates and due dates are only meaningful in the school's timezone. */
const TIME_ZONE = process.env.CANVAS_TZ ?? "America/New_York";

const FILTERS = [
  { label: "Upcoming", query: "?bucket=upcoming" },
  { label: "Unsubmitted", query: "?bucket=unsubmitted" },
  { label: "Overdue", query: "?bucket=overdue" },
  { label: "All this term", query: "?" },
  { label: "All terms", query: "?term=all" },
];

export default async function Page({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const bucketParam = first(params.bucket);

  if (!process.env.CANVAS_TOKEN) {
    return <SetupNotice />;
  }

  const { rows, courseCount, skipped, fetchedAt } = await getAssignmentRows({
    term: first(params.term) === "all" ? "all" : "current",
    bucket: isBucket(bucketParam) ? bucketParam : undefined,
    undated: first(params.undated) === "1",
    revalidate: first(params.refresh) === "1" ? 0 : undefined,
  });

  const now = new Date(fetchedAt);
  const csvHref = `/api/assignments?format=csv&${new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v] as [string, string]] : [],
    ),
  )}`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="font-mono text-2xl font-bold tracking-tight text-[#A51C30]">
          HBS ASSIGNMENTS
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {rows.length} assignment{rows.length === 1 ? "" : "s"} across{" "}
          {courseCount} course{courseCount === 1 ? "" : "s"} &middot; as of{" "}
          {formatLocal(fetchedAt, TIME_ZONE)}
        </p>
      </header>

      <nav className="mb-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => (
          <Link
            key={filter.label}
            href={filter.query}
            className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium transition hover:border-[#A51C30] hover:text-[#A51C30] dark:border-stone-700"
          >
            {filter.label}
          </Link>
        ))}
        <span className="grow" />
        <Link
          href="?refresh=1"
          className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium transition hover:border-[#A51C30] hover:text-[#A51C30] dark:border-stone-700"
        >
          Refresh
        </Link>
        <a
          href={csvHref}
          className="rounded-full bg-[#A51C30] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#8a1728]"
        >
          Download CSV
        </a>
      </nav>

      {skipped.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">
            Skipped {skipped.length} course{skipped.length === 1 ? "" : "s"}:
          </p>
          <ul className="mt-1 list-inside list-disc">
            {skipped.map((entry) => (
              <li key={entry.course}>
                {entry.course} &mdash; {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
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
      ) : (
        <AssignmentTable rows={rows} now={now} />
      )}

      <footer className="mt-8 text-xs text-stone-500">
        Only covers items Canvas models as assignments. Cases handed out through
        Modules, Pages, or Files will not appear here.
      </footer>
    </main>
  );
}

function AssignmentTable({ rows, now }: { rows: AssignmentRow[]; now: Date }) {
  return (
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
        {rows.map((row) => {
          const days = daysUntil(row.dueAt, now);
          const overdue = days !== null && days < 0 && !row.submitted;
          const soon = days !== null && days >= 0 && days <= 2;

          return (
            <tr
              key={`${row.courseId}-${row.url}`}
              className="border-b border-stone-200 align-top dark:border-stone-800"
            >
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
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#A51C30] hover:underline"
                >
                  {row.assignment}
                </a>
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
        })}
      </tbody>
    </table>
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

/** A repeated query param arrives as an array; take the first value. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
