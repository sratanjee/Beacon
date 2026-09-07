# Multi-Tenant Beacon — Friends & Family Edition

Open Beacon to 3-10 invited friends. Each has their own resume, positioning,
saved list, fit scores, and generated artifacts. Companies + job postings stay
shared (fetched once, viewed by everyone through per-user lenses).

## Purpose

Sarang built Beacon to compress his own EM job search. Friends have asked to
use it. This spec turns Beacon into a small closed-invite multi-user tool
without pulling it toward being a "product" (no signup page, no billing, no
public marketing). Sarang keeps admin control; friends get their own private
dashboard against the same underlying job data.

## Success criteria

- Sarang can invite an email; that person receives a magic link, logs in,
  picks a role pack, uploads a resume + positioning, and sees their own
  scored dashboard within one weekly-scan cycle (or an initial backfill).
- Sarang's existing data (resume, positioning, scores, saved list, generated
  docs) is preserved end-to-end as `user_id = <sarang-uuid>`.
- Every dashboard/route is user-scoped: no user can see another user's
  resume, saved list, cover letters, or scores.
- Weekly scan runs once for the shared job data; per-user scoring runs for
  each active user in the same invocation (within Vercel's 800s budget).
- Cost stays under $5/month with 5 active users on Sarang's Anthropic key.

## Non-goals (v1)

- Per-user company list customization (v1: everyone sees the same 166+ pool).
- User-editable role-pack regex (v1: pick one of 6 presets, no edit).
- User-to-user sharing, referrals, comments on each other's picks.
- Admin analytics dashboard, usage metering, or rate-limiting UI.
- Billing / paid tier / signup page.
- Multiple resumes per user (still one PDF per profile; re-upload replaces).
- Public read-only access.

## Auth model

- **Supabase Auth magic link.** Login page: enter email → link mailed via
  Supabase's default email provider → click link → 30-day cookie session.
  No passwords.
- **Allowlist.** New table `invited_emails(email primary key, invited_by uuid,
  invited_at timestamptz)`. Supabase Auth is configured so magic-link requests
  are only issued if the email exists in `invited_emails`. Enforced in
  `/api/auth/magic-link` (custom route) — Supabase's built-in signup can't
  reference our table directly.
- **Admin.** Sarang's account gets `role = 'admin'` on his `users` row.
  `/admin/invites` page lets him add/remove emails from the allowlist. All
  other users get `role = 'user'`.
- **Middleware.** Existing `middleware.ts` cookie-check retires. New check:
  `supabase.auth.getUser()` server-side; unauthenticated redirects to
  `/login`. Public routes: `/login`, `/api/auth/*`, `/api/run-weekly-scan`
  (still `CRON_SECRET`-guarded).

## Data model

### New tables

```sql
create table users (
  id           uuid primary key,           -- matches auth.users.id
  email        text not null unique,
  display_name text,
  role         text not null default 'user' check (role in ('user', 'admin')),
  role_pack    text not null check (role_pack in ('em','sr_ic','pm','designer','data_ml','gtm')),
  positioning  text,
  resume_pdf_path text,
  resume_text  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table invited_emails (
  email        text primary key,
  invited_by   uuid references users(id),
  invited_at   timestamptz not null default now()
);

-- Precomputed at scan time: which role packs each job matches.
-- Replaces jobs.title_matches_role (which was implicitly EM-only).
create table job_role_matches (
  job_id     bigint references jobs(id) on delete cascade,
  role_pack  text not null check (role_pack in ('em','sr_ic','pm','designer','data_ml','gtm')),
  primary key (job_id, role_pack)
);
create index job_role_matches_pack_idx on job_role_matches (role_pack, job_id);
```

### Per-user tables (add `user_id` FK)

```sql
alter table fit_scores add column user_id uuid references users(id) on delete cascade;
alter table fit_scores drop constraint fit_scores_pkey;
alter table fit_scores add primary key (job_id, user_id);

alter table generated_docs add column user_id uuid references users(id) on delete cascade;
alter table generated_docs drop constraint generated_docs_pkey;
alter table generated_docs add primary key (job_id, kind, user_id);

alter table job_states add column user_id uuid references users(id) on delete cascade;
alter table job_states drop constraint job_states_pkey;
alter table job_states add primary key (job_id, user_id);
```

### Deprecated (drop after migration)

- `profiles` (data migrates into `users` where `id = <sarang-uuid>`)
- `jobs.title_matches_role` (replaced by `job_role_matches` join)

### Row-Level Security

For every per-user table (`users`, `fit_scores`, `generated_docs`,
`job_states`), enable RLS with the standard policy:

```sql
alter table fit_scores enable row level security;
create policy user_own_rows on fit_scores
  for all using (user_id = auth.uid());
```

Server routes using the service-role client bypass RLS (needed for
scan-time scoring across all users). Client-facing SSR routes use the
user's own auth token so RLS is enforced.

## Role packs

Defined in `lib/roles/packs.ts` (typed, not in DB — packs are code-owned).

| Pack | Include regex (representative) | Exclude regex |
|---|---|---|
| `em` | (current filter — engineering manager, head of eng, director of eng, VP eng, manager X engineering) | (current excludes) |
| `sr_ic` | staff engineer, principal engineer, senior staff engineer, distinguished engineer, staff software engineer | manager, director, sales, field, solutions |
| `pm` | product manager, sr product manager, group product manager, head of product, director of product, VP product | project manager, program manager, TPM, marketing, program |
| `designer` | product designer, sr designer, staff designer, design manager, head of design, principal designer, UX designer | graphic designer, visual designer (freelance), marketing designer, brand designer |
| `data_ml` | data scientist, ML engineer, machine learning engineer, applied scientist, head of data, director of data, ML manager | data analyst (junior), BI developer, data entry, marketing analytics |
| `gtm` | customer success manager, CSM, director of CS, head of partnerships, VP partnerships, strategic account manager, account director, enterprise AE (Director+), alliances director, client services director, VP client services | SDR, BDR, sales associate, CS analyst, retention specialist, sales engineer (already caught in em pack) |

Full patterns live in code with tests, same discipline as `lib/filter/title.ts`.

At scan time, for every job upserted:

```typescript
for (const pack of PACKS) {
  if (pack.matches(job.title)) insert into job_role_matches (job_id, role_pack)
}
```

Users' dashboards query: `WHERE job_role_matches.role_pack = <user's role_pack>`.

## Company universe expansion

Beacon's current 166 companies skew heavy on eng-focused startups. To serve
GTM/CS/PM/Designer users well, add ~30 companies from adjacent B2B SaaS,
MarTech, life sciences, and healthcare data verticals. Same probe pattern
as prior seed expansions:

Candidates to probe: Veeva, Klaviyo, Iterable, Braze, Segment, Fivetran,
dbt Labs, Salesloft, Gong, Outreach, Amplitude (in seed), Mixpanel (in
seed), ZoomInfo (custom), Hex, Retool (custom), MotherDuck, Snowplow,
Tealium, Twilio Segment, mParticle, Rudderstack, Metabase, Vercel (in
seed), Netlify (in seed), Airtable (in seed), Notion (in seed), Miro (in
seed), Loom (in seed), Superhuman (custom), Front, Intercom (in seed),
Zendesk (custom), Freshworks, HubSpot (in seed), Vanta (in seed),
Drata (in seed), Rippling (custom), Deel (in seed), Gusto (in seed).

Probe each; add hits with appropriate `ats_type` + slug.

## Scan pipeline changes

1. **Fetch phase**: unchanged — pulls all companies' postings.
2. **Upsert phase**: for each job, also compute `job_role_matches` rows for
   all packs (~6 regex tests per row, negligible cost). Drop the old
   `title_matches_role` column write.
3. **Scoring phase**: loop over all `users`, for each: score any unscored
   jobs where `job_role_matches.role_pack = user.role_pack`. Prompt
   caching keys are per-user (each user's resume + positioning = separate
   cache prefix), but 90% cache-hit rate within a user's own scan.

Time budget management: existing 12-min soft budget still applies. If a
user's scan exceeds it, we bail — next scan picks up their unscored rows.

## UI changes

- **`/login`** — email input, submit → magic-link email via
  `supabase.auth.signInWithOtp` (server-side guarded by allowlist check).
- **`/onboarding`** — 3-step flow shown on first login:
  1. Pick role pack (radio buttons with 1-sentence description each).
  2. Upload resume PDF.
  3. Enter positioning (2-3 sentence textarea).
   After completion, redirect to `/dashboard` (which will show empty state
   until next scan or manual backfill).
- **`/dashboard`** — every query now filtered by `user_id = auth.uid()`
  via RLS. Adds a top-right avatar/menu showing display_name + email +
  logout.
- **`/resume`** — no functional change; queries scope to current user.
- **`/jobs/[id]`** — same page; per-user fit score, per-user cover letter
  + tailored resume, per-user save/apply state.
- **`/admin/invites`** — admin-only; add/remove emails from
  `invited_emails`. Shows each user's email, role_pack, resume-uploaded
  status, and last-active date.

## Onboarding cost

New user backfill: score all jobs matching their role_pack (~200-500
depending on pack) × Haiku ≈ $0.10-0.20 first time. Ongoing weekly:
~$0.05-0.15 per user per week. Total at 5 users: **~$1-2/week** on the
API bill.

## Migration path

Single migration handles the schema change:

1. Create `users`, `invited_emails`, `job_role_matches` tables.
2. Insert Sarang's `users` row using his email. Copy from `profiles`
   into `users` (resume_pdf_path, resume_text, positioning). Set
   `role_pack = 'em'` and `role = 'admin'`.
3. Insert Sarang's email into `invited_emails`.
4. Backfill `fit_scores.user_id`, `generated_docs.user_id`,
   `job_states.user_id` with Sarang's uuid; rebuild primary keys.
5. Populate `job_role_matches` for all existing jobs against all 6 packs
   (one-time script; ~15k jobs × 6 packs ≈ 90k rows, ~10s).
6. Drop `profiles` and `jobs.title_matches_role` last (once queries have
   migrated).

Sarang's existing dashboard state (12 great fits, saved list, Supabase
cover letter/resume) all intact after migration — same UUIDs, same URLs.

## Rollout order (informs task decomposition)

1. Schema migration + role-pack code definitions + tests.
2. Supabase Auth setup (magic-link, allowlist policy).
3. Data migration (Sarang → users, backfill user_id everywhere).
4. Middleware swap (cookie → Supabase session).
5. Onboarding page + role-pack picker.
6. All dashboard/jobs/resume routes user-scoped.
7. Scan pipeline: populate `job_role_matches`, per-user scoring loop.
8. Admin `/admin/invites` page.
9. Company universe expansion probe + insert.
10. Invite Jared + walk him through onboarding as first friend user.

## Open decisions

None — all covered above.
