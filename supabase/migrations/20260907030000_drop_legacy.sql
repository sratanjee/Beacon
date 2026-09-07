-- Multi-tenant Phase 6 cleanup: retire single-user artifacts.
-- All reads/writes now go through users + job_role_matches (Tasks 9 + 10).

alter table jobs drop column if exists title_matches_role;
drop table if exists profiles;
