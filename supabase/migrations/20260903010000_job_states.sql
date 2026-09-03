-- Phase 3.6: personal state per job (saved, applied). Replaces spec §6's
-- "sync from Google Sheet" idea in favor of tracking directly in Beacon.

create table if not exists job_states (
  job_id     bigint primary key references jobs(id) on delete cascade,
  is_saved   boolean not null default false,
  applied_at timestamptz,
  notes      text,
  updated_at timestamptz not null default now()
);

create index if not exists job_states_saved_idx on job_states (is_saved) where is_saved;
create index if not exists job_states_applied_idx on job_states (applied_at desc nulls last);
