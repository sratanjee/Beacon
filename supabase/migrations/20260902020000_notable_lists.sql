-- Extensible tags for company-level lists (Top AI, later: Lenny 100, Levels top 50, etc.)
--
-- Storing as text[] rather than discrete boolean columns keeps this open for
-- future lists without a migration per list. Filter query: WHERE 'top_ai' = ANY(notable_lists).

alter table companies
  add column if not exists notable_lists text[] not null default '{}';

-- Seed the "top_ai" list — curated AI-native companies. Iterate by editing this
-- migration set OR via SQL:
--   update companies set notable_lists = notable_lists || 'top_ai' where lower(name) = 'foo';
update companies
set notable_lists = array_append(notable_lists, 'top_ai')
where lower(name) in (
  'anthropic',
  'openai',
  'cursor',
  'perplexity',
  'cohere',
  'mistral ai',
  'hugging face',
  'runway',
  'elevenlabs',
  'harvey',
  'sierra',
  'modal',
  'baseten',
  'together ai',
  'fireworks ai',
  'langchain',
  'adept',
  'character ai',
  'suno',
  'pika',
  'inflection',
  'wispr flow',
  'glean',
  'xai'
)
  and not ('top_ai' = any(notable_lists));

create index if not exists companies_notable_lists_gin_idx
  on companies using gin (notable_lists);
