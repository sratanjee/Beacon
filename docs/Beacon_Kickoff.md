# Beacon — Kickoff Instructions for Claude Code

Full technical spec: see `Beacon_Spec.md` in this same folder — read that first for schema, architecture, and scoring logic. This doc is just the "get moving right now" checklist for the initial setup.

## Status
- Domain **mybeacon.sh** is registered and connected through Vercel (nameserver propagation in progress — this resolves on its own, nothing to configure manually on the DNS side).
- No project exists yet. Starting from zero.

## What to do first (Phase 1 from the spec)

1. **Scaffold a Next.js app** named `beacon` (TypeScript, App Router). Init git, first commit.
2. **Set up a Supabase project** named `beacon`. Run the schema from `Beacon_Spec.md` §4 (companies, jobs, fit_scores, fetch_runs, uploaded_lists tables) as an initial migration.
3. **Wire Supabase env vars** into the Next.js app (`.env.local` for dev — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Never commit this file — confirm `.env.local` is in `.gitignore` before the first commit if it isn't already).
4. **Seed the companies table** with the Levels.fyi top 50 + Lenny 100 companies gathered this session (I can paste that full list into the chat if Claude Code needs it restated — it's the same data behind `Beacon_Spec.md` §3's companies.json example).
5. **Build the Greenhouse fetcher first** (most common ATS across the target list) — a function that hits `boards-api.greenhouse.io/v1/boards/{slug}/jobs`, parses the response, and upserts into the `jobs` table. Test it against **Rippling** and **Anduril** specifically — both confirmed on Greenhouse this session, so there's a known-good result to check the output against.
6. **Push to GitHub**, then connect that repo to the existing Vercel project (the one already holding `mybeacon.sh`) via "Deploy something → Connect a GitHub repo" — this attaches the domain automatically since the domain's already tied to the Vercel project, not the repo.

## Explicitly hold off on for now
- Ashby/Lever fetchers (Phase 1 continuation, after Greenhouse is proven)
- Fit scoring / Claude API layer (Phase 3)
- Upload ingestion dropzone (Phase 6)
- Vercel Cron wiring (Phase 5) — no point scheduling a pipeline that isn't built yet

## Definition of done for this kickoff pass
Real job data from Rippling and Anduril's Greenhouse boards sitting in the Supabase `jobs` table, verifiable either via the Supabase table editor or a simple `select * from jobs` — no dashboard UI needed yet to call this phase complete.
