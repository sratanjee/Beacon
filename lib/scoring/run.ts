import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '@/lib/supabase/server';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

export type ScoringSummary = {
  scored: number;
  failed: number;
  skipped_no_resume: boolean;
  time_budget_hit: boolean;
  errors: { job_id: number; error: string }[];
};

type UnscoredJob = {
  id: number;
  title: string;
  location: string | null;
  description_text: string | null;
  companies: { name: string } | null;
};

type ScoreResponse = {
  domain_proximity: number;
  seniority_match: number;
  comp_signal: 'above_current' | 'below_current' | 'comparable' | 'undisclosed';
  overall_score: number;
  rationale: string;
};

const BATCH_SIZE = 5;
const SOFT_BUDGET_MS = 720_000; // 12 minutes of the 13.3 min maxDuration

export async function runScoring(options: { force?: boolean } = {}): Promise<ScoringSummary> {
  const startedAt = Date.now();
  const db = getServiceClient();

  const profileRes = await db
    .from('profiles')
    .select('resume_text, positioning')
    .eq('id', 1)
    .maybeSingle();
  const resumeText = profileRes.data?.resume_text?.trim();
  const positioning = profileRes.data?.positioning?.trim() || null;
  if (!resumeText) {
    return { scored: 0, failed: 0, skipped_no_resume: true, time_budget_hit: false, errors: [] };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    apiKey: key,
    defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined,
  });
  const systemPrompt = buildSystemPrompt(resumeText, positioning);

  // With force=true, wipe existing fit_scores so all EM candidates get re-scored
  // against the fresh resume/positioning context.
  if (options.force) {
    await db.from('fit_scores').delete().gt('job_id', 0);
  }

  // Pull unscored EM candidates. PostgREST applies `.is(joined_table.field, null)`
  // to the JOIN side (which fit_scores rows to include), not the parent WHERE
  // clause, so we can't use that pattern to filter jobs. Do it in two queries
  // + set-difference client-side. Cheap: both queries return only IDs plus a
  // few columns.
  const [emRes, scoredRes] = await Promise.all([
    db
      .from('jobs')
      .select('id, title, location, description_text, companies!inner(name)')
      .eq('is_active', true)
      .eq('title_matches_role', true)
      .limit(1000),
    db.from('fit_scores').select('job_id'),
  ]);
  if (emRes.error) throw new Error(`load EM candidates: ${emRes.error.message}`);
  if (scoredRes.error) throw new Error(`load scored ids: ${scoredRes.error.message}`);
  const scoredIds = new Set((scoredRes.data ?? []).map((r) => r.job_id));
  const jobs = ((emRes.data ?? []) as unknown as UnscoredJob[]).filter(
    (j) => !scoredIds.has(j.id),
  );

  const errors: { job_id: number; error: string }[] = [];
  let scored = 0;

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    if (Date.now() - startedAt > SOFT_BUDGET_MS) {
      return {
        scored,
        failed: errors.length,
        skipped_no_resume: false,
        time_budget_hit: true,
        errors,
      };
    }
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (job) => {
        try {
          const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            system: [
              {
                type: 'text',
                text: systemPrompt,
                cache_control: { type: 'ephemeral' },
              },
            ],
            messages: [
              {
                role: 'user',
                content: buildUserPrompt({
                  title: job.title,
                  company: job.companies?.name ?? 'unknown',
                  location: job.location,
                  description_text: job.description_text,
                }),
              },
            ],
          });
          const block = response.content[0];
          if (!block || block.type !== 'text') {
            throw new Error('unexpected block type');
          }
          // Haiku insists on wrapping JSON in ```json fences despite the prompt
          // telling it not to. Strip them defensively so we don't lose an
          // otherwise-valid score.
          const text = block.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
          const parsed = JSON.parse(text) as ScoreResponse;
          return { job, parsed, err: null as string | null };
        } catch (e) {
          return {
            job,
            parsed: null,
            err: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    const inserts = results
      .filter((r) => r.parsed !== null)
      .map((r) => ({
        job_id: r.job.id,
        domain_proximity_score: r.parsed!.domain_proximity,
        seniority_match_score: r.parsed!.seniority_match,
        comp_signal: r.parsed!.comp_signal,
        overall_score: r.parsed!.overall_score,
        rationale: r.parsed!.rationale,
        scored_at: new Date().toISOString(),
      }));

    if (inserts.length > 0) {
      const upsertRes = await db.from('fit_scores').upsert(inserts, { onConflict: 'job_id' });
      if (upsertRes.error) {
        for (const ins of inserts) {
          errors.push({ job_id: ins.job_id, error: `upsert: ${upsertRes.error.message}` });
        }
      } else {
        scored += inserts.length;
      }
    }

    for (const r of results) {
      if (r.err) errors.push({ job_id: r.job.id, error: r.err });
    }
  }

  return {
    scored,
    failed: errors.length,
    skipped_no_resume: false,
    time_budget_hit: false,
    errors,
  };
}
