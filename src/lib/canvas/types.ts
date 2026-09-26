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
  /**
   * A graded quiz or discussion is both an assignment and a quiz/topic, with a
   * different id in each space. Module items point at the quiz/topic id, so
   * both are needed to recognise a module item we already have.
   */
  quiz_id?: number;
  discussion_topic?: { id: number };
}

/** A single entry inside a module: a page, file, assignment, link, heading. */
export interface CanvasModuleItem {
  id: number;
  title?: string;
  position?: number;
  /** Assignment | Page | File | Discussion | Quiz | SubHeader | ExternalUrl | ExternalTool */
  type?: string;
  /** The id of the thing pointed at, in that thing's own id space. */
  content_id?: number;
  /** Set for Page items; the slug used by the pages endpoint. */
  page_url?: string;
  html_url?: string;
  external_url?: string;
  published?: boolean;
}

export interface CanvasModule {
  id: number;
  name?: string;
  position?: number;
  unlock_at?: string | null;
  items_count?: number;
  /**
   * Present only when `include[]=items` is requested AND the module is small
   * enough for Canvas to inline it. Large modules must be fetched separately.
   */
  items?: CanvasModuleItem[];
  published?: boolean;
}

export interface CanvasFile {
  id: number;
  display_name?: string;
  filename?: string;
  folder_id?: number;
  size?: number;
  updated_at?: string;
  /** Canvas spells this with a hyphen, so it is not a valid identifier. */
  "content-type"?: string;
  hidden?: boolean;
  /** Set when the file is locked to this user; such files are unreadable. */
  locked_for_user?: boolean;
}

export interface CanvasFolder {
  id: number;
  /** e.g. "course files/Course Resources/02. Case Materials" */
  full_name?: string;
  name?: string;
}

export interface CanvasPage {
  page_id: number;
  url?: string;
  title?: string;
  html_url?: string;
  updated_at?: string;
  published?: boolean;
  /** Canvas' "add to student to-do" date. Rarely set, but free when it is. */
  todo_date?: string | null;
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

/**
 * Course material that is not an assignment: the cases, notes and readings
 * handed out through Modules and Pages.
 */
export interface MaterialRow {
  courseId: number;
  course: string;
  courseCode: string;
  /**
   * Where the item sits: a module name, a Files folder path, or "" for a page
   * that belongs to neither.
   */
  module: string;
  title: string;
  /** Lowercased Canvas item type: page, file, external_url, quiz, ... */
  kind: string;
  /** Almost always null; Canvas only carries a date for to-do pages. */
  dueAt: string | null;
  url: string;
}

export interface MaterialResult {
  material: MaterialRow[];
  skipped: SkippedCourse[];
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

/**
 * What the material pass needs to know about the assignment pass, so it can
 * drop module items that are already in the assignment table.
 */
export interface KnownIds {
  assignments: Set<number>;
  quizzes: Set<number>;
  discussions: Set<number>;
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
