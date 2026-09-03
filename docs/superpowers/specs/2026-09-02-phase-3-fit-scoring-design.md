# Phase 3 — Resume Upload + Fit Scoring

Cover letter generation is deferred to Phase 3.5 (once fit scoring proves
useful) so this spec covers only: site auth, PDF resume upload + extraction,
scan-time fit scoring, and dashboard integration.

## Purpose

Currently the dashboard shows 449 EM candidates and the user's complaint is
"hard to filter — too many". Score each posting against the user's resume so
the dashboard can sort/filter by fit — reducing browse-time to the top ~20
matches. Foundation for Phase 3.5 cover-letter drafting on the shortlist.

## Success criteria

- Resume upload works: PDF → parsed text stored in `profiles` table.
- The 449 title-matched jobs get scored on a 0-100 scale against the resume;
  results populate `fit_scores` (schema already provisioned in Phase 1).
- Dashboard adds a **Fit** column, sortable, defaulting to fit-desc.
- 🎯 **Great fit** chip filters to `overall_score >= 70`.
- Site is password-protected: only the user (with `SITE_PASSWORD`) can view
  the dashboard, upload a resume, or trigger a scoring run.
- Weekly cron continues to work (no `SITE_PASSWORD` gate on
  `/api/run-weekly-scan` — uses `CRON_SECRET`).
- Under $1/month at active use.

## Auth model

Simple password gate via Next.js middleware. **Not** a full auth system —
single-user side project.

- **Env var**: `SITE_PASSWORD` — a long random string, set in Vercel + local
  `.env.local`. Never committed.
- **Middleware** (`middleware.ts` at repo root): on every request:
  - Allow `/login`, `/api/login`, `/api/run-weekly-scan`, and Next.js static
    assets through unauthenticated.
  - Read cookie `beacon_auth`. Verify it against an HMAC of `SITE_PASSWORD`.
    Valid → pass through. Invalid or missing → 302 redirect to
    `/login?next=<original_path>`.
- **`/login` page**: single password field. Posts to `/api/login`.
- **`/api/login`**: compares posted password to `SITE_PASSWORD` (constant-time
  compare). Match → set `beacon_auth` cookie (HttpOnly, Secure, SameSite=Lax,
  expires in 30 days), redirect to `next` (validated to same-origin).
- **Cookie value**: HMAC-SHA256 of the password itself, hex-encoded. On each
  request the middleware recomputes and compares. Zero DB, zero session state.

Rationale for HMAC-of-password (vs a random session token): keeps state
server-less. Downside: password rotation invalidates all sessions — fine for
a single-user site.

## Resume upload

### Table
```sql
create table profiles (
  id smallint primary key default 1 check (id = 1),  -- singleton
  resume_pdf_path text,
  resume_text text,
  updated_at timestamptz not null default now()
);
```
The `id = 1` check enforces at most one row without needing app-level
enforcement — matches the single-user model.

### Supabase Storage bucket
- Bucket name: `resumes`, **private** (no anonymous read).
- Files stored as `resume-<timestamp>.pdf`. Old versions kept for audit;
  `profiles.resume_pdf_path` points at the current one.
- No RLS policies needed — server writes with the service role client.

### Upload flow
1. `/resume` page (protected by middleware). Drop zone + status area.
2. POST `/api/resume/upload` with `multipart/form-data` containing the PDF.
3. Server validates: `Content-Type: application/pdf`, size ≤ 5 MB.
4. Server writes to Supabase Storage → gets path.
5. Server sends PDF bytes to Claude Sonnet 4.6 with prompt:
   > "Extract the plain text of this resume. Preserve section headings, bullet
   > points, dates, and role titles. Return only the plaintext content, no
   > commentary."
6. Server upserts `profiles` with new `resume_pdf_path`, `resume_text`,
   `updated_at`.
7. Response: `{ text_length, extracted_at }`. Dashboard/`/resume` page shows
   "Last uploaded 3s ago · N/449 jobs scored".

### Costs
- Claude Sonnet 4.6 with PDF input: ~$0.005 per 10-page resume.

## Fit scoring

### Persist description text on jobs
The fetchers already pull job descriptions (Greenhouse `?content=true`, Ashby
`descriptionHtml`, Lever `description`) but currently strip them from `raw`
after parsing comp. Now we need them persisted for scoring.

Migration:
```sql
alter table jobs add column if not exists description_text text;
```

Each fetcher `normalize()` function extracts plaintext from the description
HTML/text and stores it on `NormalizedJob`; `scan.ts` writes it to
`jobs.description_text` on upsert. Description size is significant (~5-20 KB
per row), so 15k rows ≈ 100-300 MB in Postgres. Acceptable.

### The scoring call
For each job with `title_matches_role AND is_active AND NOT EXISTS(fit_scores)`:

```typescript
const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 400,
  system: [
    {
      type: 'text',
      text: 'You are a career-fit evaluator...\n\nRESUME:\n' + profile.resume_text,
      cache_control: { type: 'ephemeral' },  // prompt cache the constant resume
    },
  ],
  messages: [{
    role: 'user',
    content: `Score this job posting against the resume above.\n\nTITLE: ${job.title}\nCOMPANY: ${company.name}\nLOCATION: ${job.location}\nDESCRIPTION:\n${job.description_text}\n\nReturn JSON only: { "domain_proximity": 0-100, "seniority_match": 0-100, "comp_signal": "above_current" | "below_current" | "comparable" | "undisclosed", "overall_score": 0-100, "rationale": "one sentence" }`,
  }],
});
```

- **Model**: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — cheap enough for
  weekly bulk, structured JSON reliably.
- **Prompt caching**: resume text (up to ~5000 tokens) marked
  `cache_control: ephemeral`. 90% cost reduction after the first call in a
  5-minute window.
- **Response parsing**: JSON.parse with try/catch; on parse failure, log
  and skip (don't insert).
- **Scoring formula**: `overall_score` is what Claude returns directly (not
  computed client-side) — asking Claude to weight is simpler than trying to
  encode "domain heavily, then seniority, then comp" ourselves.

### Storage
Existing `fit_scores` table schema (from Phase 1 init migration) fits:
```sql
create table fit_scores (
  job_id                 bigint primary key references jobs(id) on delete cascade,
  title_match_score      integer,
  domain_proximity_score integer,
  seniority_match_score  integer,
  comp_signal            text,
  overall_score          integer,
  rationale              text,
  scored_at              timestamptz not null default now()
);
```

Insert on scoring; existing PK constraint means one score per job. Re-score
= delete + insert (or `on conflict do update`). `title_match_score` is not
used here (we're beyond that layer) — leave null.

### When scoring runs
Two triggers:

1. **Automatic (post-scan)**: After `runScan()` finishes upserts, invoke
   `runScoring()` — scores every `title_matches_role AND is_active AND NOT EXISTS(SELECT 1 FROM fit_scores WHERE job_id = jobs.id)`
   job. Bounded by time budget (see below).

2. **Manual**: `POST /api/score-all` (bearer + cookie-auth guarded).
   Triggered by a "Score all N unscored" button on `/resume`. Same code path
   as automatic.

### Concurrency + time budget
- Batch scoring in parallel groups of 5 (`Promise.all`).
- Record `startedAt = Date.now()` at the top of `runScoring`. Between batches,
  check `Date.now() - startedAt > 720_000` (12 min of the 13.3 min Vercel Pro
  `maxDuration = 800` budget). If exceeded, stop cleanly and let the next
  scan continue on the remaining rows.
- No retry logic; failed calls remain unscored, retried next run.

### Cost
- 449 jobs × ~500 input tokens (job desc) × Haiku pricing ≈ **$0.15
  first-time backfill**.
- With prompt caching, subsequent runs (say, 50 new jobs/week) ≈ **$0.02/wk**.
- No unbounded surprise: `runScoring()` only processes unscored rows.

## Dashboard integration

### New column
Between **Remote** and **Comp**, add **Fit** column showing `overall_score`
(0-100). Formatting:
- ≥ 70: bold green
- 40-69: neutral
- < 40: dim
- null: `—`

Hover tooltip shows `rationale` text.

### Sort default
Once `profiles.resume_text` exists, default sort becomes `fit desc` (was
`first_seen desc`). The URL param `?sort=first_seen&dir=desc` still works.

### New chip
**🎯 Great fit** — filters `fit_scores.overall_score >= 70`. Same visual
treatment as existing chips (violet-600 when active).

### Query changes
Dashboard SELECT joins `fit_scores` LEFT so unscored jobs still show.

## New routes

| Route | Method | Purpose |
|---|---|---|
| `/login` | GET | Password form |
| `/api/login` | POST | Verify password, set cookie |
| `/resume` | GET | Upload UI, status, "score all" button |
| `/api/resume/upload` | POST | Multipart PDF → text → profiles |
| `/api/score-all` | POST | Trigger bulk scoring (bearer OR cookie) |

## New files

- `middleware.ts` — auth gate
- `lib/auth/cookie.ts` — HMAC helpers, cookie name constant
- `lib/scoring/prompt.ts` — system + user prompt builders
- `lib/scoring/run.ts` — `runScoring()` + batching + time budget
- `lib/pdf/extract.ts` — Claude Sonnet PDF extraction wrapper
- `app/login/page.tsx` + `app/api/login/route.ts`
- `app/resume/page.tsx` + `app/api/resume/upload/route.ts`
- `app/api/score-all/route.ts`
- `supabase/migrations/20260902030000_profiles_and_description.sql`

## Env vars added

- `SITE_PASSWORD` — plaintext, long random
- `ANTHROPIC_API_KEY` — Anthropic API key with Haiku + Sonnet access

## Rollout order (informs task decomposition)

1. Migration: `profiles` table + `jobs.description_text` column + storage bucket
2. Middleware + login (test: hit `/dashboard` → redirected; enter password → in)
3. Fetcher changes to persist description text
4. Trigger scan; confirm description text lands
5. Resume upload flow (PDF → Claude Sonnet → profiles)
6. Scoring pipeline (Haiku call, prompt caching, batching)
7. Manual score-all trigger; confirm 449 rows scored
8. Dashboard integration: Fit column + 🎯 chip + sort default
9. Wire post-scan auto-scoring
10. Trigger production scan; verify new jobs auto-scored

## Non-goals (deferred)

- **Cover letter generation** — Phase 3.5.
- **Per-job customized resume** — user pushed back on the risk.
- **Multiple resume variants** — one resume per profile row.
- **Score history / trends** — one score per job, overwritten on re-score.
- **Email notifications on new great-fit** — future.
- **Multi-user / real auth** — single-user password only.

## Open decisions

None — all covered above.
