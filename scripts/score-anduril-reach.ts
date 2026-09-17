// One-shot: score all leadership-shaped Anduril software roles against
// Sarang's resume + positioning, upsert into fit_scores, print top matches
// with URLs. Uses the same prompt as lib/scoring/run.ts so results match the
// dashboard's own scoring format.
//
// Run:
//   cd /Users/sratanjee/Beacon
//   npx tsx --env-file=.env.local scripts/score-anduril-reach.ts /tmp/beacon/anduril_leadership.json

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import { buildSystemPrompt, buildUserPrompt } from '../lib/scoring/prompt';

const SARANG_UID = '29c1c2bd-30cf-4316-9909-01ec89e793f1';
const BATCH = 5;

type JobRow = {
  id: number;
  title: string;
  url: string;
  location: string | null;
  comp_min: number | null;
  comp_max: number | null;
  description_text: string | null;
};

async function main() {
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: score-anduril-reach.ts <path-to-jobs.json>');
  process.exit(1);
}

const raw: JobRow[] = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// Curate: drop hardware/RF/mechanical/clearance-gated titles; keep software/eng
// leadership + Staff/Principal IC in software/ML/infra/platform/data/analytics.
const EXCLUDE = /(hardware|mechanical|electrical|\brf\b|radio frequency|structural|aerodynam|aerospace|acoustic|propulsion|manufactur|assembly|machinist|quality|supply chain|physical|firmware|controls?\b|actuator|avionics|battery|mechatronics|radar|missile|rocket|weapons|antenna|ordnance|munition|gun|explosive)/i;
const INCLUDE = /(software|engineer|engineering|platform|product|data|infra|infrastructure|security|reliability|backend|frontend|full[- ]stack|mobile|web|ml |ai |machine learning|cloud|devops|sre|analytics|staff|principal|manager|director|head of|vp |chief|technical)/i;
const jobs = raw.filter(
  (j) => INCLUDE.test(j.title) && !EXCLUDE.test(j.title) && j.description_text,
);
console.log(`Filtered ${raw.length} → ${jobs.length} scorable roles`);

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});

const { data: user, error: userErr } = await db
  .from('users')
  .select('resume_text, positioning')
  .eq('id', SARANG_UID)
  .single();
if (userErr || !user?.resume_text) {
  console.error('user load failed', userErr);
  process.exit(1);
}
const systemPrompt = buildSystemPrompt(user.resume_text, user.positioning);

type Scored = {
  job: JobRow;
  parsed: {
    domain_proximity: number;
    seniority_match: number;
    comp_signal: string;
    overall_score: number;
    rationale: string;
  };
};
const results: Scored[] = [];
const errors: { job_id: number; error: string }[] = [];

for (let i = 0; i < jobs.length; i += BATCH) {
  const batch = jobs.slice(i, i + BATCH);
  process.stdout.write(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(jobs.length / BATCH)}...`);
  const batchResults = await Promise.all(
    batch.map(async (job) => {
      try {
        const resp = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          messages: [
            {
              role: 'user',
              content: buildUserPrompt({
                title: job.title,
                company: 'Anduril Industries',
                location: job.location,
                description_text: job.description_text,
              }),
            },
          ],
        });
        const block = resp.content[0];
        if (!block || block.type !== 'text') throw new Error('bad block');
        const text = block.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(text);
        return { job, parsed, err: null as string | null };
      } catch (e) {
        return { job, parsed: null, err: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  for (const r of batchResults) {
    if (r.parsed) results.push({ job: r.job, parsed: r.parsed });
    else errors.push({ job_id: r.job.id, error: r.err ?? 'unknown' });
  }
  console.log(` ok=${batchResults.filter((r) => r.parsed).length} err=${batchResults.filter((r) => r.err).length}`);
}

// Upsert into fit_scores so results show up on Sarang's dashboard.
if (results.length > 0) {
  const inserts = results.map((r) => ({
    job_id: r.job.id,
    user_id: SARANG_UID,
    domain_proximity_score: r.parsed.domain_proximity,
    seniority_match_score: r.parsed.seniority_match,
    comp_signal: r.parsed.comp_signal,
    overall_score: r.parsed.overall_score,
    rationale: r.parsed.rationale,
    scored_at: new Date().toISOString(),
  }));
  const { error: upErr } = await db
    .from('fit_scores')
    .upsert(inserts, { onConflict: 'job_id,user_id' });
  if (upErr) console.error('fit_scores upsert error:', upErr);
  else console.log(`\nUpserted ${inserts.length} fit_scores for Sarang.`);
}

// Rank & print top 25
results.sort((a, b) => b.parsed.overall_score - a.parsed.overall_score);
console.log('\n=== TOP 25 by fit ===\n');
for (const r of results.slice(0, 25)) {
  const lo = r.job.comp_min;
  const hi = r.job.comp_max;
  const comp =
    lo && hi ? `$${Math.round(lo / 1000)}k-$${Math.round(hi / 1000)}k` : lo || hi ? `$${Math.round((lo ?? hi)! / 1000)}k+` : 'undisclosed';
  const target = hi != null && hi >= 290_000 ? ' 💎' : '';
  console.log(`[${r.parsed.overall_score.toString().padStart(3)}] ${r.job.title}${target}`);
  console.log(`      loc: ${r.job.location ?? '—'} | comp: ${comp}`);
  console.log(`      why: ${r.parsed.rationale}`);
  console.log(`      ${r.job.url}\n`);
}

if (errors.length > 0) console.error(`\n${errors.length} errors:`, errors.slice(0, 5));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
