# Beacon — Job Scanner & Fit Dashboard: Technical Spec

**Project name:** Beacon
**Suggested repo/folder name:** `beacon` (lowercase, matches Vercel project slug convention)
**Suggested Vercel project name:** `beacon`
**Suggested Supabase project name:** `beacon`
**Domain:** mybeacon.sh

## 1. Goal

A weekly-refreshing tool that:
1. Pulls currently-open Engineering Manager / Head of Eng / Director of Eng roles from a tracked list of companies
2. Scores each one against a resume for fit (title, domain, comp, location)
3. Stores results in a queryable database
4. Surfaces them in a simple web dashboard — sortable, filterable, with direct links

**Non-goals (v1):** applying automatically, tracking application status end-to-end (the existing Google Sheet tracker still owns that), scraping companies with aggressive anti-bot protection (LinkedIn itself is explicitly out of scope — its ToS prohibits scraping, and it'll get the account flagged).

---

## 2. Architecture

```
┌─────────────────┐     ┌──────────────────┐
│  Company List    │────▶│                  │
│  (companies.json)│     │                  │
└─────────────────┘     │   Job Fetcher    │     ┌──────────────────┐
                         │   (per-ATS       │────▶│  Supabase        │
┌─────────────────┐     │    clients)       │     │  (Postgres DB    │
│  Uploaded Lists  │────▶│                  │     │   + Storage)     │
│  (PDF/image, via │     │                  │     └────────┬─────────┘
│   ingestion path)│     └──────────────────┘              │
└─────────────────┘                                        │
                                                             │
┌─────────────────┐     ┌──────────────────┐               │
│  Resume (text)   │────▶│  Fit Scorer       │◀──────────────┘
│                  │     │  (rules + Claude  │
└─────────────────┘     │   API scoring)     │
                         └────────┬──────────┘
                                  │
                         ┌────────▼──────────┐
                         │  Dashboard         │
                         │  (Next.js/Vercel)  │
                         │  filter/sort/links │
                         │  + upload dropzone │
                         └────────────────────┘
```

**Stack:** Next.js app deployed on **Vercel** (frontend + serverless API routes), **Supabase** for Postgres (data) and Storage (uploaded files). Vercel Cron triggers the weekly fetch job by hitting an API route; that route runs the fetcher → ingestion → scorer pipeline and writes to Supabase. The dashboard reads from Supabase directly (via its client SDK) — no separate backend server needed.

---

## 3. Data sources — the key technical decision

Most modern ATS platforms expose **public, unauthenticated JSON APIs** for their job boards. This matters a lot: it means real structured data instead of fragile HTML scraping.

| ATS | Public API pattern | Notes |
|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{company}/jobs` | Very common; Anduril, many others |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{company}` | Wispr Flow, many AI-native startups |
| Lever | `api.lever.co/v0/postings/{company}` | Common at mid-size startups |
| Custom (own site) | No API — fallback to `web_search`/`web_fetch` | Rippling, Scale AI job posts, most mega-caps |

**Build order:** implement the three API-based clients first (cheap, reliable, structured). Custom-site companies fall into a "manual/best-effort" tier that uses search + fetch, same as this session's manual process, and is expected to be less complete.

**companies.json** — the source-of-truth target list, seeded from the Levels.fyi top 50 + Lenny 100 companies already gathered this session:

```json
[
  { "name": "Rippling", "ats": "greenhouse", "slug": "rippling" },
  { "name": "Anduril", "ats": "greenhouse", "slug": "andurilindustries" },
  { "name": "Wispr Flow", "ats": "ashby", "slug": "wispr-flow" },
  { "name": "Scale AI", "ats": "custom", "url": "https://scale.com/careers" },
  ...
]
```

---

## 3a. User-uploaded list ingestion (PDF / image → companies)

A dropzone in the dashboard where you can drag in a screenshot, photo, or PDF of a company list (a newsletter roundup, a conference sponsor list, a screenshotted tweet — whatever) and have it parsed into structured company entries, same idea as the Lenny 100 table pulled apart earlier this session.

**Recommended approach: skip building a separate OCR pipeline.** Tesseract or a hosted OCR API adds a dependency and still needs a second pass to structure the raw text into company names. Claude's API natively accepts PDFs and images as input — send the file directly with a structured-extraction prompt:

```
Extract every company name mentioned in this document/image. For each one, note
any additional context given (role title, comp figure, funding stage, etc. if present).
Return JSON only: [{ "name": str, "context": str | null }]
```

**Flow:**
1. User uploads file via dashboard dropzone → stored in **Supabase Storage**
2. API route sends the file to the Claude API (PDF/image input) with the extraction prompt above
3. Response is parsed; each extracted company is checked against the existing `companies` table (fuzzy match on name to avoid duplicates like "Anduril" vs "Anduril Industries")
4. New companies are inserted with `ats_type = null` until someone (you, or a follow-up automated check) determines whether they're on Greenhouse/Ashby/Lever or need the custom-site fallback tier
5. Once classified, they're eligible for the next weekly fetch run like any other tracked company

This turns "I saw an interesting list somewhere" into "it's in the tracker" in one upload, without you manually retyping company names — exactly what happened by hand with the Lenny 100 screenshot this session, just automated.

---

## 4. Data model (Supabase / Postgres)

```sql
CREATE TABLE companies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  ats_type TEXT,           -- 'greenhouse' | 'ashby' | 'lever' | 'custom' | NULL (unclassified)
  ats_slug TEXT,
  comp_leaderboard_rank INTEGER,  -- from Levels.fyi top 50, nullable
  comp_leaderboard_total INTEGER, -- e.g. 715000, nullable
  source TEXT DEFAULT 'seed'      -- 'seed' | 'upload:<upload_id>'
);

CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES companies(id),
  external_id TEXT,        -- ATS's own job ID, for de-dup
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  location TEXT,
  remote_ok BOOLEAN,
  comp_min INTEGER,        -- parsed from posting if present
  comp_max INTEGER,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,   -- flips to false if it disappears from a fetch
  UNIQUE(company_id, external_id)
);

CREATE TABLE fit_scores (
  job_id BIGINT REFERENCES jobs(id),
  title_match_score INTEGER,     -- 0-100
  domain_proximity_score INTEGER,-- 0-100, mobile/web/AI-adjacent weighted up
  comp_signal TEXT,               -- 'above_current' | 'below_current' | 'undisclosed'
  overall_score INTEGER,          -- weighted composite
  rationale TEXT,                 -- short LLM-generated note on why
  scored_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE fetch_runs (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ DEFAULT now(),
  companies_checked INTEGER,
  new_jobs_found INTEGER,
  errors JSONB  -- list of {company, error} for failed fetches
);

CREATE TABLE uploaded_lists (
  id BIGSERIAL PRIMARY KEY,
  storage_path TEXT NOT NULL,    -- Supabase Storage object path
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending', -- 'pending' | 'processed' | 'error'
  companies_extracted INTEGER,
  raw_extraction JSONB           -- the Claude API's raw structured output, kept for audit/debug
);
```

`is_active` + `last_seen_at` gives you the "this posting disappeared" signal for free — useful given how fast reqs closed on us this session (Anduril's Internal Tools listing). `companies.source` lets the dashboard show "added from your upload" vs. the original seed list, and `uploaded_lists.raw_extraction` keeps the original parse around in case a fuzzy-match dedup was wrong and needs a manual fix.

---

## 5. Fit scoring logic

Two layers, cheapest first:

**Layer 1 — rule-based filter (fast, free, runs on every job):**
- Title regex match: `Engineering Manager|Senior EM|Head of Engineering|Director of Engineering`
- Reject if title contains disqualifying terms unless explicitly reviewed: `Sales|Marketing|Product Manager` (avoid false positives on adjacent titles)
- Location check against a remote/relocation-open flag

**Layer 2 — Claude API scoring (only for jobs that pass Layer 1):**
Send the job description + resume text to the API with a structured-output prompt:

```
Score this job posting against this resume on a 0-100 scale for:
1. domain_proximity: how close is the role's actual domain (mobile/web/consumer vs.
   backend/infra/hardware) to this person's background?
2. seniority_match: does the scope match their actual level?
3. comp_signal: if compensation is disclosed, is it above/below/comparable to $372,950?
Return JSON only: {domain_proximity, seniority_match, comp_signal, rationale}
```

This mirrors exactly what happened manually this session (Rippling and Scale AI both got an honest "here's the real stretch" assessment) — codifying that into the scoring prompt is what keeps the tool from just being a keyword matcher that oversells fit.

**Composite score** = weighted average, surfaced in the dashboard sort order. Recommend weighting domain_proximity highest — a "Head of Engineering" title at a hardware company (per this session's Anduril lesson) shouldn't outrank a "Senior EM" title at a mobile-native company.

---

## 6. Dashboard requirements

- **Table view**, sortable by: overall score, comp, date first seen
- **Filters**: remote-only toggle, min comp, domain proximity threshold
- **Row detail**: company, title, link (opens posting), comp range, rationale text, "days since first seen"
- **Status column** synced from the existing Google Sheet tracker (read-only mirror, so you're not maintaining state in two places) — or, if you want single-source-of-truth, migrate the tracker into this DB entirely and retire the sheet
- **New-this-week badge** on rows where `first_seen_at` is within the last 7 days
- **Upload dropzone** — drag-and-drop a PDF/image, shows processing status, then shows extracted companies with an "add to tracking" confirm step (don't auto-add silently — a bad OCR/extraction pass could pollute the company list, so a quick human confirm before it's added to the fetch rotation is worth the extra click)

Build as a Next.js app on Vercel: API routes handle the fetch/score/ingest pipeline server-side, the frontend queries Supabase directly via its JS client for the table view. No separate backend service to stand up or host — Vercel + Supabase covers both compute and data in one deploy.

---

## 7. Scheduling / deployment

**Vercel Cron Jobs** — since the dashboard's already deploying to Vercel, use its built-in cron feature to hit a `/api/run-weekly-scan` route on a schedule. No separate scheduler service needed; it's configured directly in `vercel.json`:

```json
{
  "crons": [{ "path": "/api/run-weekly-scan", "schedule": "0 8 * * 1" }]
}
```

That route runs the fetch → ingest → score pipeline and writes straight to Supabase. One caveat: Vercel serverless functions have execution time limits (varies by plan) — if checking 50+ companies sequentially risks timing out, either fan out into parallel requests within the function, or split the route into per-batch calls the cron triggers in sequence. Worth checking current limits on your plan before assuming a single run fits in one invocation.

**Local dev:** `next dev` against your Supabase project (free tier is plenty for this scale of data) — no separate local DB needed since Supabase is already hosted.

**Everything lives in one deploy:** push to your Vercel-connected git repo, and both the dashboard and the API/cron routes ship together. No Railway/Fly.io/separate backend needed with this stack.

---

## 8. Build phases

| Phase | Deliverable |
|---|---|
| 1 | Supabase project set up (schema above); companies table seeded from this session's Levels.fyi top 50 + Lenny 100; Greenhouse/Ashby/Lever fetchers working, writing jobs to Supabase |
| 2 | Layer 1 rule-based filtering + de-dup logic |
| 3 | Layer 2 Claude API scoring wired in |
| 4 | Minimal Next.js dashboard (table, sort, filter) deployed to Vercel, reading from Supabase |
| 5 | Vercel Cron wired to a weekly run of the fetch → score pipeline |
| 6 | Upload ingestion: dropzone → Supabase Storage → Claude API extraction → confirm-and-add flow |
| 7 | Polish: custom-ATS fallback tier, Google Sheet sync (optional), new-this-week badges |

Phases 1-4 are a solid weekend-scale build; 5-7 can come later once the core loop is working and you're actually using it day to day.

---

## 9. Open decisions before starting

- Single source of truth: keep the Google Sheet tracker as the "status/next-step" tool and this DB as "discovery only," or fully replace the sheet?
- Include LinkedIn job postings? (Recommend **no** — scraping LinkedIn violates their ToS and risks account action; stick to company ATS sources, which are public and scrape-tolerant by design. This applies equally to the upload-ingestion path — if someone screenshots a LinkedIn job post, extracting the company name from the image is fine, but don't build automated LinkedIn scraping into the fetcher.)
- Auth on the dashboard: since this is single-user (just you), simplest is no auth at all if you're comfortable with the Vercel URL being effectively private-by-obscurity, or a basic Supabase Auth magic-link if you want it properly locked down, especially before you deploy it publicly reachable.
- Supabase free tier limits (500MB DB, 1GB storage) are far more than this project needs at this scale — no cost decision required to get started.
