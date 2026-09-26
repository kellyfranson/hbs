# HBS Assignments

Pulls every assignment across your active Canvas courses into one list, sorted
by due date, plus a second pass over Modules, Pages and Files to catch the
cases, exhibits and readings Canvas doesn't model as assignments. Built with
Next.js 16 (App Router). Your Canvas token stays on the server and is never
sent to the browser.

- `/` — the assignment table, with filters and a CSV download
- `/?material=1` — also lists course material from Modules, Pages and Files
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
| `material` | `1` | Add the Modules/Pages/Files pass |
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

## The course material pass

Plenty of course material is never an assignment: case PDFs, exhibits,
templates, technical notes. `?material=1` walks each course's **Modules**,
**Pages** and **Files** and lists what it finds, grouped by module name or
Files folder path.

It costs several extra requests per course, so it's opt-in — click **Load
course material** or add `?material=1`.

What each source actually contributes varies a lot by school. Measured against
an HBS RC section:

| Source | Result |
| --- | --- |
| Modules | **empty** — HBS uses no Canvas modules at all |
| Pages | ~30 items, and the tab is *disabled* on some courses (404) |
| Files | ~212 items — this is where the cases actually are |

So Files is the one doing the work here, organised into folders like
`Course Resources/02. Case Materials/Exhibits`. The Modules leg still matters
for courses that do use them, and costs nothing when they don't.

Two things keep the output from being a dump of everything:

- **Anything already in the assignment table is removed.** That's harder than
  matching ids: a graded quiz or discussion exists twice in Canvas under two
  different ids, and module items point at the quiz/topic id rather than the
  assignment id. The dedupe collects all three id spaces.
- **Pages and files reachable through a module aren't listed twice.**

Sub-headings, unpublished items, hidden files and files locked to you are
dropped. Where Canvas has a `todo_date` on a page, it's shown.

A disabled course feature answers 404 or 403 on its endpoint. That's treated as
*absence*, not failure, so a course with Pages switched off still contributes
its files. Genuine faults still mark the course skipped.

## Downloading the files

`scripts/download-material.mjs` mirrors each course's Files area to disk as
`<out>/<COURSE_CODE>/<folder path>/<file>`, preserving Canvas' own folder
structure.

```bash
node scripts/download-material.mjs --ext pdf --dry-run
node scripts/download-material.mjs --ext pdf
```

Always dry-run first — it prints the file count and total size per course
without fetching anything. Course video can be enormous (3.7 GB of the 3.9 GB
in one RC section), which is what `--ext` is for.

| Flag | Default | Notes |
| --- | --- | --- |
| `--out` | `~/Downloads/HBS Course Material` | Destination root |
| `--ext` | all | Comma-separated, e.g. `--ext pdf,pptx`. Matches by extension *or* by the MIME type Canvas reports, so extension-less files are still caught |
| `--course` | all | Repeatable, by course code |
| `--term` | `current` | `all` includes past terms |
| `--max-mb` | none | Skip files larger than this |
| `--dry-run` | off | Report only |

Downloads run five at a time, write to a `.part` file and rename on completion,
and skip anything already on disk at the right size — so an interrupted run
resumes rather than restarting.

> **Keep the downloads out of this repo.** Course cases are copyrighted, and
> this repository is public. The default destination is deliberately outside
> the project; `/downloads/` is gitignored as a backstop.

## Where the cases actually are

**The cases are not in Canvas.** At HBS an assignment description reads:

> Case: [Stock-Based Compensation at Twitter (119-032)](https://hbsp.harvard.edu/tu/07562cf2)

That link goes to Harvard Business Publishing, not to a Canvas file. Of 241
assignments, 156 carry a description, and those descriptions hold **113 HBP
links** against 106 Canvas file links. No API token can fetch the HBP items —
they sit in a coursepack behind your own HBP login, and this tool does not try
to work around that.

What it does instead:

- Every material link in an assignment description is extracted and shown
  under that assignment, badged `HBP`, `FILE` or `LINK`. Descriptions come back
  with the assignments call, so this costs no extra requests.
- The CSV gets one row per link, carrying the parent assignment's due date, so
  sorting by date gives you a reading schedule.
- The downloader writes `CASES-on-HBP.md` into the output folder: a per-class
  index of every HBP case and reading, ordered by due date, sitting next to the
  files it *could* fetch.

### Hidden files

A file linked from a description often does not appear in the course Files
listing at all, because Canvas marks it `hidden` — meaning "not shown in the
Files tab", not "inaccessible". Walking Files alone silently misses these (19
of them in one RC section). The downloader follows description links too and
ignores `hidden` for those, while still respecting `locked_for_user`, which is
a real restriction.

## Caveats

Anything that exists only in a PDF syllabus — a common home for case dates — is
not in Canvas at all and cannot be pulled. The material pass gets you the case
*files*; some dates may still be manual.

At HBS the case *assignments* are Canvas assignments (`FIN1 | Class 3 | Mighty
Squirrel Brewery and Taproom`), so the main table covers the schedule — but the
case documents themselves are on HBP and cannot be downloaded. See
[Where the cases actually are](#where-the-cases-actually-are).

If assignment counts look off, check the `term` column via **All terms**: the
filter relies on Canvas term start/end dates being set sensibly.

## Deploying

This is a personal tool with no authentication — anyone who can reach the URL
sees your assignments. Keep it local, or put a login in front of it before
hosting it anywhere public.
