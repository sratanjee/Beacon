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

export async function runScoring(options: { force?: boolean; userId?: string } = {}): Promise<ScoringSummary> {
  const db = getServiceClient();

  const users = options.userId
    ? [{ id: options.userId }]
    : ((
        await db
          .from('users')
          .select('id')
          .not('resume_text', 'is', null)
          .not('role_pack', 'is', null)
      ).data ?? []);

  let totalScored = 0;
  const errors: { job_id: number; error: string }[] = [];
  let skippedNoResume = users.length === 0;

  for (const u of users) {
    const result = await scoreForUser(db, u.id, !!options.force);
    if (result.skipped) skippedNoResume = true;
    totalScored += result.scored;
    for (const e of result.errors) errors.push(e);
    if (result.time_budget_hit) {
      return {
        scored: totalScored,
        failed: errors.length,
        skipped_no_resume: skippedNoResume,
        time_budget_hit: true,
        errors,
      };
    }
  }

  return {
    scored: totalScored,
    failed: errors.length,
    skipped_no_resume: skippedNoResume && totalScored === 0,
    time_budget_hit: false,
    errors,
  };
}

async function scoreForUser(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  force: boolean,
): Promise<{
  scored: number;
  errors: { job_id: number; error: string }[];
  time_budget_hit: boolean;
  skipped: boolean;
}> {
  const startedAt = Date.now();

  const userRes = await db
    .from('users')
    .select('resume_text, positioning, role_pack')
    .eq('id', userId)
    .maybeSingle();
  const resumeText = userRes.data?.resume_text?.trim();
  const positioning = userRes.data?.positioning?.trim() || null;
  const rolePack = userRes.data?.role_pack;
  if (!resumeText || !rolePack) {
    return { scored: 0, errors: [], time_budget_hit: false, skipped: true };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    apiKey: key,
    defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined,
  });
  const systemPrompt = buildSystemPrompt(resumeText, positioning);

  if (force) {
    await db.from('fit_scores').delete().eq('user_id', userId);
  }

  const [emRes, scoredRes] = await Promise.all([
    db
      .from('jobs')
      .select(
        'id, title, location, description_text, companies!inner(name), job_role_matches!inner(role_pack)',
      )
      .eq('is_active', true)
      .eq('job_role_matches.role_pack', rolePack)
      .limit(1000),
    db.from('fit_scores').select('job_id').eq('user_id', userId),
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
      return { scored, errors, time_budget_hit: true, skipped: false };
    }
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (job) => {
        try {
          const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            system: [
              { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
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
          const text = block.text
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
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
        user_id: userId,
        domain_proximity_score: r.parsed!.domain_proximity,
        seniority_match_score: r.parsed!.seniority_match,
        comp_signal: r.parsed!.comp_signal,
        overall_score: r.parsed!.overall_score,
        rationale: r.parsed!.rationale,
        scored_at: new Date().toISOString(),
      }));

    if (inserts.length > 0) {
      const upsertRes = await db.from('fit_scores').upsert(inserts, { onConflict: 'job_id,user_id' });
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

  return { scored, errors, time_budget_hit: false, skipped: false };
}
