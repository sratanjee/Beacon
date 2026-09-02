-- Beacon: initial seed
--
-- This is a starter list of companies with confirmed public ATS endpoints (probed
-- 2026-09-02). Only the greenhouse rows will be scanned in Phase 1 — ashby/lever/
-- custom entries wait for their respective fetchers.
--
-- TODO(sarang): paste in the full Levels.fyi top 50 + Lenny 100 list gathered in
-- the kickoff session. Each row needs: name, ats_type, ats_slug (or ats_url for
-- custom). Rippling was in the spec as greenhouse but its slug 404s — treating it
-- as custom pending confirmation.

insert into companies (name, ats_type, ats_slug) values
  ('Anduril Industries', 'greenhouse', 'andurilindustries'),
  ('Airtable',           'greenhouse', 'airtable'),
  ('Figma',              'greenhouse', 'figma'),
  ('Databricks',         'greenhouse', 'databricks'),
  ('Stripe',             'greenhouse', 'stripe'),
  ('Airbnb',             'greenhouse', 'airbnb'),
  ('Discord',            'greenhouse', 'discord'),
  ('Robinhood',          'greenhouse', 'robinhood'),
  ('Coinbase',           'greenhouse', 'coinbase'),
  ('Asana',              'greenhouse', 'asana'),
  ('Affirm',             'greenhouse', 'affirm'),
  ('Anthropic',          'greenhouse', 'anthropic'),
  ('Brex',               'greenhouse', 'brex'),
  ('Mercury',            'greenhouse', 'mercury'),
  ('Gusto',              'greenhouse', 'gusto'),
  ('Instacart',          'greenhouse', 'instacart'),
  ('Pinterest',          'greenhouse', 'pinterest'),
  ('Reddit',             'greenhouse', 'reddit'),
  -- Ashby — waiting on lib/ats/ashby.ts
  ('Ramp',               'ashby',      'ramp'),
  ('Notion',             'ashby',      'notion'),
  ('Linear',             'ashby',      'linear'),
  ('Vercel',             'ashby',      'vercel'),
  ('Supabase',           'ashby',      'supabase'),
  ('OpenAI',             'ashby',      'openai'),
  ('Perplexity',         'ashby',      'perplexity'),
  ('Wispr Flow',         'ashby',      'wispr-flow')
on conflict (lower(name)) do nothing;

-- Custom-tier: no public ATS API, needs Phase 7 fallback (search + fetch).
insert into companies (name, ats_type, ats_url) values
  ('Rippling',    'custom', 'https://www.rippling.com/careers/open-roles'),
  ('DoorDash',    'custom', 'https://careersatdoordash.com'),
  ('Retool',      'custom', 'https://retool.com/careers'),
  ('Hugging Face','custom', 'https://apply.workable.com/huggingface'),
  ('Scale AI',    'custom', 'https://scale.com/careers')
on conflict (lower(name)) do nothing;
