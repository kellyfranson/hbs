/** The slices of the Canvas LMS REST API this app actually reads. */

export interface CanvasTerm {
  name?: string;
  start_at?: string | null;
  end_at?: string | null;
}

export interface CanvasCourse {
  id: number;
  name?: string;
  course_code?: string;
  term?: CanvasTerm;
  /**
   * Courses outside their access window come back as stubs carrying only this
   * flag, with no name and sometimes no id. They have to be filtered out.
   */
  access_restricted_by_date?: boolean;
}

export interface CanvasSubmission {
  workflow_state?: string;
}

export interface CanvasAssignment {
  id: number;
  name?: string;
  due_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  html_url?: string;
  /** Only present when the request asks for `include[]=submission`. */
  submission?: CanvasSubmission;
}

/** One flattened row: an assignment plus the course it belongs to. */
export interface AssignmentRow {
  courseId: number;
  course: string;
  courseCode: string;
  term: string;
  assignment: string;
  /** ISO-8601 UTC, or null when the assignment has no due date. */
  dueAt: string | null;
  points: number | null;
  submitted: boolean;
  submissionTypes: string[];
  url: string;
}

/** A course we could list but could not read assignments from. */
export interface SkippedCourse {
  course: string;
  reason: string;
}

export interface AssignmentsResult {
  rows: AssignmentRow[];
  courseCount: number;
  skipped: SkippedCourse[];
  fetchedAt: string;
}

/** Canvas' own server-side filters for the assignments endpoint. */
export const BUCKETS = [
  "upcoming",
  "unsubmitted",
  "past",
  "overdue",
  "future",
] as const;

export type Bucket = (typeof BUCKETS)[number];

export function isBucket(value: string | undefined): value is Bucket {
  return !!value && (BUCKETS as readonly string[]).includes(value);
}

export interface AssignmentsQuery {
  /** "current" keeps only courses whose term is running today. */
  term?: "current" | "all";
  bucket?: Bucket;
  /** Include assignments that have no due date. Off by default. */
  undated?: boolean;
  /** Seconds to cache Canvas responses for. 0 forces a fresh pull. */
  revalidate?: number;
}
