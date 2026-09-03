-- Phase 4: standalone "how I want to be positioned" text on profile, read
-- alongside resume by all Claude prompts (cover letter, tailored resume,
-- fit scoring).

alter table profiles add column if not exists positioning text;
