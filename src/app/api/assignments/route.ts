import type { NextRequest } from "next/server";
import {
  CanvasError,
  getAssignmentRows,
  getMaterialRows,
} from "@/lib/canvas/client";
import { toCsv } from "@/lib/canvas/csv";
import { isBucket, type SkippedCourse } from "@/lib/canvas/types";

const TIME_ZONE = process.env.CANVAS_TZ ?? "America/New_York";

/**
 * GET /api/assignments
 *   ?format=csv|json &term= &bucket= &undated=1 &refresh=1 &material=1
 *
 * `material=1` adds the Modules/Pages pass. In CSV both passes share one file,
 * told apart by the `kind` column.
 *
 * Route Handlers are uncached by default in this version; the underlying
 * Canvas fetches carry their own revalidation, so this stays request-time.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const bucket = params.get("bucket") ?? undefined;

  const query = {
    term: params.get("term") === "all" ? ("all" as const) : ("current" as const),
    bucket: isBucket(bucket) ? bucket : undefined,
    undated: params.get("undated") === "1",
    revalidate: params.get("refresh") === "1" ? 0 : undefined,
  };

  // The material pass costs three extra requests per course, so it is opt-in.
  const withMaterial = params.get("material") === "1";

  try {
    const [result, materialResult] = await Promise.all([
      getAssignmentRows(query),
      withMaterial ? getMaterialRows(query) : undefined,
    ]);

    if (params.get("format") !== "csv") {
      return Response.json(
        materialResult
          ? {
              ...result,
              material: materialResult.material,
              // Both passes hit the same unreadable courses, so report each
              // course once rather than once per endpoint that failed on it.
              skipped: dedupeByCourse([
                ...result.skipped,
                ...materialResult.skipped,
              ]),
            }
          : result,
      );
    }

    const filename = `assignments-${result.fetchedAt.slice(0, 10)}.csv`;

    // The BOM makes Excel open UTF-8 course names correctly on Windows.
    const body = toCsv(result.rows, TIME_ZONE, materialResult?.material);

    return new Response("﻿" + body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const status = error instanceof CanvasError ? (error.status ?? 502) : 500;
    const message =
      error instanceof CanvasError ? error.message : "Unexpected server error.";

    return Response.json({ error: message }, { status });
  }
}

function dedupeByCourse(skipped: SkippedCourse[]): SkippedCourse[] {
  const byCourse = new Map<string, SkippedCourse>();
  for (const entry of skipped) {
    if (!byCourse.has(entry.course)) byCourse.set(entry.course, entry);
  }
  return [...byCourse.values()];
}
