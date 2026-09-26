/**
 * Server-side Canvas LMS client.
 *
 * This module must never be imported from a Client Component: it reads
 * CANVAS_TOKEN, and anything reachable from a `"use client"` boundary ends up
 * in the browser bundle. Import it only from Server Components, Route
 * Handlers, and Server Actions.
 */

import type {
  AssignmentRow,
  AssignmentsQuery,
  AssignmentsResult,
  CanvasAssignment,
  CanvasCourse,
  SkippedCourse,
} from "./types";

const DEFAULT_BASE = "https://hbs.instructure.com";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 100; // guard against a malformed Link header looping forever
const MAX_ATTEMPTS = 4;

/** Seconds. Canvas data changes slowly; this keeps refreshes off the API. */
export const DEFAULT_REVALIDATE = 300;

export class CanvasError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CanvasError";
    this.status = status;
  }
}

function config() {
  const token = process.env.CANVAS_TOKEN;
  if (!token) {
    throw new CanvasError(
      "CANVAS_TOKEN is not set. Add it to .env.local and restart the dev server.",
    );
  }
  const base = (process.env.CANVAS_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
  return { token, base };
}

/**
 * Pull the `next` URL out of a Link header.
 *
 * The Web `fetch` Response has no parsed `links` accessor, so Canvas'
 * `<url>; rel="next", <url>; rel="last"` has to be split by hand.
 */
function nextPageUrl(header: string | null): string | null {
  if (!header) return null;

  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?([^"\s;]+)"?/);
    if (match && match[2] === "next") return match[1];
  }
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch one page, retrying transient failures with exponential backoff.
 *
 * Canvas throttles with 403s carrying a "Rate Limit Exceeded" body, and its
 * load balancer serves occasional 502/504s. Retrying is the difference between
 * a clean pull and a random mid-export failure.
 */
async function fetchPage(
  url: string,
  token: string,
  revalidate: number,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Caching is opt-in in this version of Next, and a positive
        // `revalidate` opts in even though the request carries an
        // Authorization header. That is safe here only because the token is a
        // single server-side env var, so every request is the same user.
        ...(revalidate > 0
          ? { next: { revalidate, tags: ["canvas"] } }
          : { cache: "no-store" as const }),
      });

      if (response.ok) return response;

      if (response.status === 401) {
        throw new CanvasError(
          "Canvas rejected the token (401). It may be expired or revoked.",
          401,
        );
      }

      const retryable =
        response.status === 429 || response.status >= 500 || isThrottled(response);

      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw new CanvasError(
          `Canvas returned ${response.status} ${response.statusText} for ${redact(url)}`,
          response.status,
        );
      }

      await sleep(backoffMs(attempt, response.headers.get("retry-after")));
      continue;
    } catch (error) {
      // A 401 is final; so is the last attempt. Everything else gets a retry.
      if (error instanceof CanvasError && error.status === 401) throw error;
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(backoffMs(attempt, null));
    }
  }

  throw lastError instanceof CanvasError
    ? lastError
    : new CanvasError(
        `Could not reach Canvas at ${redact(url)}: ${String(lastError)}`,
      );
}

/** Canvas signals throttling with a 403 whose body says so. */
function isThrottled(response: Response): boolean {
  return (
    response.status === 403 &&
    response.headers.get("x-rate-limit-remaining") === "0"
  );
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return 500 * 2 ** (attempt - 1);
}

/** Query strings can carry ids; keep them out of error messages and logs. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** Follow Canvas' Link-header pagination and collect every item. */
async function paginate<T>(
  url: string,
  token: string,
  revalidate: number,
): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = url;

  for (let page = 0; page < MAX_PAGES && next; page++) {
    const response: Response = await fetchPage(next, token, revalidate);
    const payload: unknown = await response.json();

    if (!Array.isArray(payload)) {
      // Canvas reports some errors with a 200 and an {"errors": [...]} body.
      throw new CanvasError(
        `Expected a list from ${redact(next)} but got an object.`,
      );
    }

    items.push(...(payload as T[]));
    next = nextPageUrl(response.headers.get("link"));
  }

  return items;
}

function courseLabel(course: CanvasCourse): string {
  return course.name ?? `Course ${course.id}`;
}

/**
 * True if the course's term is running right now.
 *
 * `enrollment_state=active` alone still returns every prior-term course you
 * are technically still enrolled in, which is how a six-class semester turns
 * into twenty courses of output.
 */
function isCurrent(course: CanvasCourse, now: Date): boolean {
  const start = course.term?.start_at ? new Date(course.term.start_at) : null;
  const end = course.term?.end_at ? new Date(course.term.end_at) : null;

  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

async function getCourses(
  base: string,
  token: string,
  revalidate: number,
): Promise<CanvasCourse[]> {
  const url = `${base}/api/v1/courses?enrollment_state=active&include[]=term&per_page=100`;
  const courses = await paginate<CanvasCourse>(url, token, revalidate);
  return courses.filter((c) => !c.access_restricted_by_date && c.id);
}

async function getAssignments(
  base: string,
  token: string,
  courseId: number,
  bucket: string | undefined,
  revalidate: number,
): Promise<CanvasAssignment[]> {
  const params = new URLSearchParams({
    per_page: "100",
    order_by: "due_at",
  });
  params.append("include[]", "submission");
  if (bucket) params.set("bucket", bucket);

  return paginate<CanvasAssignment>(
    `${base}/api/v1/courses/${courseId}/assignments?${params}`,
    token,
    revalidate,
  );
}

function toRow(
  course: CanvasCourse,
  assignment: CanvasAssignment,
  base: string,
): AssignmentRow {
  return {
    courseId: course.id,
    course: courseLabel(course),
    courseCode: course.course_code ?? "",
    term: course.term?.name ?? "",
    assignment: assignment.name ?? "",
    dueAt: assignment.due_at ?? null,
    points: assignment.points_possible ?? null,
    submitted: assignment.submission?.workflow_state === "submitted",
    submissionTypes: assignment.submission_types ?? [],
    url:
      assignment.html_url ??
      `${base}/courses/${course.id}/assignments/${assignment.id}`,
  };
}

/**
 * Every assignment across the caller's active courses, sorted by due date.
 *
 * Courses are fetched concurrently and failures are isolated: a concluded or
 * unpublished course 403s on its assignments endpoint, and that should cost
 * you one course, not the whole pull.
 */
export async function getAssignmentRows(
  query: AssignmentsQuery = {},
): Promise<AssignmentsResult> {
  const { token, base } = config();
  const revalidate = query.revalidate ?? DEFAULT_REVALIDATE;
  const now = new Date();

  let courses = await getCourses(base, token, revalidate);
  if (query.term !== "all") {
    courses = courses.filter((course) => isCurrent(course, now));
  }

  const settled = await Promise.allSettled(
    courses.map((course) =>
      getAssignments(base, token, course.id, query.bucket, revalidate),
    ),
  );

  const rows: AssignmentRow[] = [];
  const skipped: SkippedCourse[] = [];

  settled.forEach((outcome, index) => {
    const course = courses[index];

    if (outcome.status === "rejected") {
      skipped.push({
        course: courseLabel(course),
        reason:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
      });
      return;
    }

    for (const assignment of outcome.value) {
      if (!query.undated && !assignment.due_at) continue;
      rows.push(toRow(course, assignment, base));
    }
  });

  // Undated rows sort last; ISO-8601 UTC strings sort correctly as text.
  rows.sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));

  return {
    rows,
    courseCount: courses.length,
    skipped,
    fetchedAt: now.toISOString(),
  };
}
