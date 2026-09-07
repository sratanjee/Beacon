-- Migrate Sarang's data from profiles singleton into users, then backfill
-- user_id on fit_scores / generated_docs / job_states.

-- 1. Insert Sarang's user row.
insert into users (id, email, display_name, role, role_pack, positioning, resume_pdf_path, resume_text)
select
  '29c1c2bd-30cf-4316-9909-01ec89e793f1'::uuid,
  'sratanjee@gmail.com',
  'Sarang',
  'admin',
  'em',
  positioning,
  resume_pdf_path,
  resume_text
from profiles
where id = 1
on conflict (id) do update
  set positioning     = excluded.positioning,
      resume_pdf_path = excluded.resume_pdf_path,
      resume_text     = excluded.resume_text;

-- 2. Sarang goes on his own allowlist so he can log in via magic link too.
insert into invited_emails (email, invited_by)
values ('sratanjee@gmail.com', '29c1c2bd-30cf-4316-9909-01ec89e793f1'::uuid)
on conflict (email) do nothing;

-- 3. Backfill user_id on existing per-user rows. Everything currently in DB
-- belongs to Sarang.
update fit_scores     set user_id = '29c1c2bd-30cf-4316-9909-01ec89e793f1'::uuid where user_id is null;
update generated_docs set user_id = '29c1c2bd-30cf-4316-9909-01ec89e793f1'::uuid where user_id is null;
update job_states     set user_id = '29c1c2bd-30cf-4316-9909-01ec89e793f1'::uuid where user_id is null;

-- 4. Rebuild composite primary keys now that user_id is populated.
alter table fit_scores      drop constraint fit_scores_pkey;
alter table fit_scores      add primary key (job_id, user_id);
alter table fit_scores      alter column user_id set not null;

alter table generated_docs  drop constraint generated_docs_pkey;
alter table generated_docs  add primary key (job_id, kind, user_id);
alter table generated_docs  alter column user_id set not null;

alter table job_states      drop constraint job_states_pkey;
alter table job_states      add primary key (job_id, user_id);
alter table job_states      alter column user_id set not null;
