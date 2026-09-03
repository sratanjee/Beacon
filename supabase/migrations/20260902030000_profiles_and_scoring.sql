-- Phase 3: profiles (singleton resume row) + jobs.description_text (for scoring)

create table if not exists profiles (
  id smallint primary key default 1 check (id = 1),  -- enforced singleton
  resume_pdf_path text,
  resume_text text,
  updated_at timestamptz not null default now()
);

alter table jobs add column if not exists description_text text;

-- Private storage bucket for uploaded resume PDFs. Anon reads blocked; the
-- server (service role) is the only writer/reader.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;
