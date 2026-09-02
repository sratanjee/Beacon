import 'server-only';
import { fetchGreenhouseJobs } from '@/lib/ats/greenhouse';
import { fetchAshbyJobs } from '@/lib/ats/ashby';
import { fetchLeverJobs } from '@/lib/ats/lever';
import { getServiceClient } from '@/lib/supabase/server';
import type { FetchError, NormalizedJob } from '@/lib/ats/types';

type CompanyRow = {
  id: number;
  name: string;
  ats_type: string | null;
  ats_slug: string | null;
};

const FETCHERS: Record<string, (slug: string) => Promise<NormalizedJob[]>> = {
  greenhouse: fetchGreenhouseJobs,
  ashby: fetchAshbyJobs,
  lever: fetchLeverJobs,
};

export type ScanSummary = {
  run_id: number | null;
  companies_checked: number;
  jobs_seen: number;
  new_jobs_found: number;
  errors: FetchError[];
};

export async function runScan(): Promise<ScanSummary> {
  const db = getServiceClient();

  const { data: companies, error } = await db
    .from('companies')
    .select('id, name, ats_type, ats_slug')
    .in('ats_type', Object.keys(FETCHERS));
  if (error) throw new Error(`Load companies: ${error.message}`);

  const errors: FetchError[] = [];
  let jobsSeen = 0;
  let newJobs = 0;

  for (const c of companies ?? []) {
    const fetcher = c.ats_type ? FETCHERS[c.ats_type] : undefined;
    if (!fetcher || !c.ats_slug) {
      errors.push({ company: c.name, error: `no fetcher for ats_type=${c.ats_type}` });
      continue;
    }
    try {
      const jobs = await fetcher(c.ats_slug);
      jobsSeen += jobs.length;
      const inserted = await upsertJobs(c, jobs);
      newJobs += inserted;
    } catch (e) {
      errors.push({
        company: c.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const { data: run, error: runErr } = await db
    .from('fetch_runs')
    .insert({
      companies_checked: (companies ?? []).length,
      jobs_seen: jobsSeen,
      new_jobs_found: newJobs,
      errors,
    })
    .select('id')
    .single();

  if (runErr) {
    return {
      run_id: null,
      companies_checked: (companies ?? []).length,
      jobs_seen: jobsSeen,
      new_jobs_found: newJobs,
      errors: [...errors, { company: '<fetch_runs insert>', error: runErr.message }],
    };
  }

  return {
    run_id: run.id,
    companies_checked: (companies ?? []).length,
    jobs_seen: jobsSeen,
    new_jobs_found: newJobs,
    errors,
  };
}

async function upsertJobs(company: CompanyRow, jobs: NormalizedJob[]): Promise<number> {
  const db = getServiceClient();
  if (jobs.length === 0) return 0;

  const { data: existing, error: existingErr } = await db
    .from('jobs')
    .select('external_id')
    .eq('company_id', company.id);
  if (existingErr) throw new Error(`load existing jobs for ${company.name}: ${existingErr.message}`);
  const known = new Set((existing ?? []).map((r) => r.external_id));

  const now = new Date().toISOString();
  const rows = jobs.map((j) => ({
    company_id: company.id,
    external_id: j.external_id,
    title: j.title,
    url: j.url,
    location: j.location,
    remote_ok: j.remote_ok,
    comp_min: j.comp_min,
    comp_max: j.comp_max,
    last_seen_at: now,
    is_active: true,
    raw: j.raw,
  }));

  const { error: upErr } = await db
    .from('jobs')
    .upsert(rows, { onConflict: 'company_id,external_id', ignoreDuplicates: false });
  if (upErr) throw new Error(`upsert jobs for ${company.name}: ${upErr.message}`);

  const seenIds = new Set(jobs.map((j) => j.external_id));
  const toDeactivate = [...known].filter((id) => !seenIds.has(id));
  if (toDeactivate.length > 0) {
    const { error: deactErr } = await db
      .from('jobs')
      .update({ is_active: false })
      .eq('company_id', company.id)
      .in('external_id', toDeactivate);
    if (deactErr) throw new Error(`deactivate stale jobs for ${company.name}: ${deactErr.message}`);
  }

  let created = 0;
  for (const j of jobs) if (!known.has(j.external_id)) created += 1;
  return created;
}
