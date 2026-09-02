# Beacon

Weekly-refreshing scanner for EM / Head of Eng / Director of Eng roles across a
tracked company list, scored against a resume, surfaced in a dashboard.

- Full spec: `docs/Beacon_Spec.md`
- Phase 1 kickoff notes: `docs/Beacon_Kickoff.md`

## Stack

- **Next.js** (App Router, TypeScript) on **Vercel**
- **Supabase** (Postgres + Storage)
- **Vercel Cron** triggers `/api/run-weekly-scan` weekly

## Phase 1 status

Scaffold + Greenhouse fetcher + `/api/run-weekly-scan` endpoint that writes into
Supabase. No dashboard, no scoring, no upload ingestion yet — those are Phases
3, 4, 6.

## Setup

### 1. Create a Supabase project

Go to https://supabase.com/dashboard → New project. Name it `beacon`, pick a
region close to Vercel's default (`us-east-1` or `us-west-1`).

Grab from **Settings → API**:
- Project URL (`https://<ref>.supabase.co`)
- `anon` public key
- `service_role` secret key

### 2. Apply the schema

```bash
pnpm supabase login                          # one-time device flow
pnpm supabase link --project-ref <ref>       # from the project URL
pnpm supabase db push                        # applies migrations/*.sql
pnpm supabase db seed                        # loads seed.sql
```

If `db seed` isn't wired for your CLI version, run the seed via the SQL editor
in Supabase Studio (paste `supabase/seed.sql`).

### 3. Configure env

```bash
cp .env.local.example .env.local
# then fill in the SUPABASE_* values and a random CRON_SECRET
```

For Vercel: set the same vars in **Project → Settings → Environment Variables**.

### 4. Run locally

```bash
pnpm dev
# in another shell:
curl -X POST -H "authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)" \
  http://localhost:3000/api/run-weekly-scan
```

The response is a JSON summary; check `select * from jobs` in Supabase Studio
to confirm rows landed (Anduril alone will drop ~2,000+ postings).

## Scheduling

`vercel.json` defines a weekly cron at Monday 08:00 UTC hitting
`/api/run-weekly-scan`. Vercel Cron sends the request with
`authorization: Bearer <CRON_SECRET>` — set that env var in the Vercel project
for auth to pass.

## Layout

```
app/
  page.tsx                      # placeholder landing
  api/run-weekly-scan/route.ts  # scheduled entrypoint
lib/
  ats/greenhouse.ts             # Greenhouse boards API client
  ats/types.ts                  # NormalizedJob shape
  pipeline/scan.ts              # iterates companies → fetch → upsert → record run
  supabase/{server,browser}.ts  # SDK clients
supabase/
  migrations/*.sql              # schema (Beacon_Spec.md §4)
  seed.sql                      # initial company list
vercel.json                     # cron config
```

## Not built yet

- Ashby fetcher (`lib/ats/ashby.ts`) — companies already seeded with `ats_type='ashby'`
- Lever fetcher (`lib/ats/lever.ts`)
- Custom-tier fallback (search + fetch)
- Layer 1 rule-based title filter
- Layer 2 Claude API scoring
- Dashboard (table, sort, filter)
- Upload ingestion (PDF/image → Claude → companies)
