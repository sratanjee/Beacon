-- Multi-tenant Beacon: users, invited_emails, job_role_matches.
-- Preserves existing profiles data via a companion migration; this one only
-- adds structure.

create table if not exists users (
  id              uuid primary key,          -- matches auth.users.id
  email           text not null unique,
  display_name    text,
  role            text not null default 'user' check (role in ('user', 'admin')),
  role_pack       text check (role_pack in ('em','sr_ic','pm','designer','data_ml','gtm')),
  positioning     text,
  resume_pdf_path text,
  resume_text     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists invited_emails (
  email       text primary key,
  invited_by  uuid references users(id) on delete set null,
  invited_at  timestamptz not null default now()
);

create table if not exists job_role_matches (
  job_id     bigint not null references jobs(id) on delete cascade,
  role_pack  text   not null check (role_pack in ('em','sr_ic','pm','designer','data_ml','gtm')),
  primary key (job_id, role_pack)
);
create index if not exists job_role_matches_pack_idx on job_role_matches (role_pack, job_id);

-- Add user_id to per-user tables. Nullable initially so migration Task 3
-- can backfill Sarang's uuid; a later migration will flip to NOT NULL.
alter table fit_scores      add column if not exists user_id uuid references users(id) on delete cascade;
alter table generated_docs  add column if not exists user_id uuid references users(id) on delete cascade;
alter table job_states      add column if not exists user_id uuid references users(id) on delete cascade;
