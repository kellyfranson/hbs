import type { AssignmentRow } from "./types";

const COLUMNS = [
  "course",
  "course_code",
  "term",
  "assignment",
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

export function toCsv(rows: AssignmentRow[], timeZone: string): string {
  const now = new Date();

  const lines = rows.map((row) =>
    [
      row.course,
      row.courseCode,
      row.term,
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
  );

  // Excel needs CRLF to treat embedded newlines in quoted fields correctly.
  return [COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}
