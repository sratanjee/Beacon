-- Beacon: initial schema
-- Reference: Beacon_Spec.md §4

create table if not exists companies (
  id                     bigserial primary key,
  name                   text        not null,
  ats_type               text,       -- 'greenhouse' | 'ashby' | 'lever' | 'custom' | null (unclassified)
  ats_slug               text,
  ats_url                text,       -- for custom-tier companies with no API
  comp_leaderboard_rank  integer,    -- from Levels.fyi top 50, nullable
  comp_leaderboard_total integer,    -- e.g. 715000, nullable
  source                 text        not null default 'seed', -- 'seed' | 'upload:<upload_id>'
  created_at             timestamptz not null default now()
);

create unique index if not exists companies_name_lower_idx
  on companies (lower(name));

create table if not exists jobs (
  id             bigserial primary key,
  company_id     bigint      not null references companies(id) on delete cascade,
  external_id    text        not null, -- ATS's own job ID, for de-dup
  title          text        not null,
  url            text        not null,
  location       text,
  remote_ok      boolean,
  comp_min       integer,
  comp_max       integer,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  is_active      boolean     not null default true,
  raw            jsonb,                    -- keep the source payload for later reprocessing
  unique (company_id, external_id)
);

create index if not exists jobs_company_active_idx on jobs (company_id, is_active);
create index if not exists jobs_first_seen_idx on jobs (first_seen_at desc);

create table if not exists fit_scores (
  job_id                 bigint primary key references jobs(id) on delete cascade,
  title_match_score      integer, -- 0-100
  domain_proximity_score integer, -- 0-100
  seniority_match_score  integer, -- 0-100
  comp_signal            text,    -- 'above_current' | 'below_current' | 'undisclosed'
  overall_score          integer, -- weighted composite
  rationale              text,
  scored_at              timestamptz not null default now()
);

create table if not exists fetch_runs (
  id                 bigserial primary key,
  run_at             timestamptz not null default now(),
  companies_checked  integer     not null default 0,
  jobs_seen          integer     not null default 0,
  new_jobs_found     integer     not null default 0,
  errors             jsonb       not null default '[]'::jsonb
);

create table if not exists uploaded_lists (
  id                  bigserial primary key,
  storage_path        text not null,
  uploaded_at         timestamptz not null default now(),
  status              text not null default 'pending', -- 'pending' | 'processed' | 'error'
  companies_extracted integer,
  raw_extraction      jsonb
);
