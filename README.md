# HBS Assignments

Pulls every assignment across your active Canvas courses into one list, sorted
by due date. Built with Next.js 16 (App Router). Your Canvas token stays on the
server and is never sent to the browser.

- `/` — the assignment table, with filters and a CSV download
- `/api/assignments` — the same data as JSON
- `/api/assignments?format=csv` — CSV download

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

## Caveats

Only covers items Canvas models as **assignments**. Cases distributed through
Modules, Pages, or Files won't appear — `?undated=1` catches the subset that
exist as assignments with no due date, but not the rest. If your count looks
low, the next place to look is `/api/v1/courses/:id/modules?include[]=items` or
`/api/v1/planner/items`.

## Deploying

This is a personal tool with no authentication — anyone who can reach the URL
sees your assignments. Keep it local, or put a login in front of it before
hosting it anywhere public.
