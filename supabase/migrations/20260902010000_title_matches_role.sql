-- Phase 2 title filter — Layer 1
--
-- Adds a boolean flag set by scan.ts at upsert time. Backfill happens on the
-- next scan run (TS regex is source of truth); intermediate window where
-- existing rows have `false` is acceptable because no dashboard reads this yet.

alter table jobs
  add column if not exists title_matches_role boolean not null default false;

-- Partial index over active-and-matching rows — the shape Phase 3's scorer will
-- query: WHERE title_matches_role AND is_active AND fit_scored_at IS NULL
create index if not exists jobs_title_matches_active_idx
  on jobs (title_matches_role, last_seen_at desc)
  where is_active;
