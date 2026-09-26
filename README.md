# HBS Assignments

Pulls every assignment across your active Canvas courses into one list, sorted
by due date, plus a second pass over Modules and Pages to catch the cases and
readings Canvas doesn't model as assignments. Built with Next.js 16 (App
Router). Your Canvas token stays on the server and is never sent to the browser.

- `/` — the assignment table, with filters and a CSV download
- `/?material=1` — also lists course material from Modules and Pages
- `/api/assignments` — the same data as JSON
- `/api/assignments?format=csv&material=1` — one CSV covering both passes

## Setup

```bash
npm install
```

Create a Canvas access token: log into Canvas → **Account** → **Settings** →
**New Access Token**. Copy it when it's shown; Canvas won't show it again.

Create a file called `.env.local` in the project root and paste the token in:

```bash
CANVAS_TOKEN=1234~yourlongtokenstring
CANVAS_BASE_URL=https://hbs.instructure.com
CANVAS_TZ=America/New_York
```

`.env.local` is gitignored, so the token never reaches GitHub. Next.js reads it
automatically at startup — restart the dev server after editing it.

```bash
npm run dev
```

Then open http://localhost:3000.

## Filters

Set from the buttons in the UI, or by query string on either the page or the API:

| Param | Values | Meaning |
| --- | --- | --- |
| `term` | `current` (default), `all` | `current` keeps only courses whose term is running today |
| `bucket` | `upcoming`, `unsubmitted`, `past`, `overdue`, `future` | Canvas-side filter |
| `undated` | `1` | Include assignments with no due date (excluded by default) |
| `material` | `1` | Add the Modules/Pages pass |
| `refresh` | `1` | Bypass the cache and re-pull from Canvas |
| `format` | `csv` | API route only — download instead of JSON |

## How it works

`src/lib/canvas/client.ts` is the whole Canvas layer. It is server-only: it
reads `CANVAS_TOKEN` and must never be imported from a `"use client"` file.

- **Pagination** follows the `Link: <...>; rel="next"` header. The Web `fetch`
  Response has no parsed `links` accessor, so the header is split by hand.
- **Retries** use exponential backoff on 429/5xx and on the 403 Canvas returns
  when you're throttled, honouring `Retry-After`. A 401 fails immediately.
- **Courses are fetched concurrently** with `Promise.allSettled`, so a course
  that 403s (concluded, unpublished, outside its access window) costs you that
  course, not the whole pull. Skipped courses are listed in the UI.
- **Term filtering matters**: `enrollment_state=active` alone returns every
  prior-term course you're still enrolled in, which is how six classes turn
  into twenty. Courses are filtered against their term's start/end dates.
- **Caching** is opt-in in Next 16. Canvas responses are cached for 5 minutes
  (`DEFAULT_REVALIDATE`) so refreshing the page doesn't hammer the API. This is
  safe only because the token is a single server-side env var — every request
  is the same user. **If you ever deploy this for more than one person, that
  cache has to become per-user or be turned off.**

## The Modules/Pages pass

Plenty of course material is never an assignment: a case PDF hanging off a
module, a technical note on a page, with the date living in the syllabus rather
than in Canvas. `?material=1` walks every course's modules (including each
module's items) and its pages, and lists what it finds grouped by module.

It costs three extra requests per course, so it's opt-in rather than automatic
— click **Load course material** or add `?material=1`.

Two things make the output usable rather than a dump of everything:

- **Anything already in the assignment table is removed.** That's harder than
  matching ids, because a graded quiz or discussion exists twice in Canvas
  under two different ids, and module items point at the quiz/topic id rather
  than the assignment id. The dedupe collects all three id spaces.
- **Pages already reachable through a module aren't listed twice.** Only pages
  belonging to no module get their own entry.

Sub-headings and unpublished items are dropped. Where Canvas has a `todo_date`
on a page, it's shown.

## Caveats

Even with both passes, anything that exists only in a PDF syllabus — the usual
home for HBS case dates — is not in Canvas at all and cannot be pulled. The
Modules pass gets you the case *files*; the dates may still be manual.

If assignment counts look off, check the `term` column via **All terms**: the
filter relies on Canvas term start/end dates being set sensibly.

## Deploying

This is a personal tool with no authentication — anyone who can reach the URL
sees your assignments. Keep it local, or put a login in front of it before
hosting it anywhere public.
