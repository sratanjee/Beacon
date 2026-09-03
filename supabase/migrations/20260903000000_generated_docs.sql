-- Phase 3.5: cached generated artifacts (cover letters, tailored resumes) +
-- company summary blurbs.

create table if not exists generated_docs (
  job_id       bigint      not null references jobs(id) on delete cascade,
  kind         text        not null check (kind in ('cover_letter', 'tailored_resume')),
  text         text        not null,
  model        text        not null,
  tokens_in    integer,
  tokens_out   integer,
  generated_at timestamptz not null default now(),
  primary key (job_id, kind)
);

alter table companies add column if not exists summary text;
alter table companies add column if not exists summary_generated_at timestamptz;
