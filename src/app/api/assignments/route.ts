import type { NextRequest } from "next/server";
import { CanvasError, getAssignmentRows } from "@/lib/canvas/client";
import { toCsv } from "@/lib/canvas/csv";
import { isBucket } from "@/lib/canvas/types";

const TIME_ZONE = process.env.CANVAS_TZ ?? "America/New_York";

/**
 * GET /api/assignments?format=csv|json&term=&bucket=&undated=1&refresh=1
 *
 * Route Handlers are uncached by default in this version; the underlying
 * Canvas fetches carry their own revalidation, so this stays request-time.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const bucket = params.get("bucket") ?? undefined;

  try {
    const result = await getAssignmentRows({
      term: params.get("term") === "all" ? "all" : "current",
      bucket: isBucket(bucket) ? bucket : undefined,
      undated: params.get("undated") === "1",
      revalidate: params.get("refresh") === "1" ? 0 : undefined,
    });

    if (params.get("format") !== "csv") {
      return Response.json(result);
    }

    const filename = `assignments-${result.fetchedAt.slice(0, 10)}.csv`;

    // The BOM makes Excel open UTF-8 course names correctly on Windows.
    return new Response("﻿" + toCsv(result.rows, TIME_ZONE), {
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
