import { NormalizedJob } from './types';

type GreenhouseLocation = { name?: string | null };

type GreenhouseJob = {
  id: number;
  title: string;
  absolute_url: string;
  location?: GreenhouseLocation | null;
  updated_at?: string;
  first_published?: string;
};

type GreenhouseResponse = {
  jobs?: GreenhouseJob[];
  meta?: { total?: number };
};

const REMOTE_RE = /\b(remote|anywhere|distributed|work[\s-]?from[\s-]?home)\b/i;

export async function fetchGreenhouseJobs(slug: string): Promise<NormalizedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'beacon-fetcher/0.1 (+https://mybeacon.sh)' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Greenhouse ${slug}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as GreenhouseResponse;
  const jobs = body.jobs ?? [];
  return jobs.map(normalize);
}

function normalize(job: GreenhouseJob): NormalizedJob {
  const location = job.location?.name?.trim() || null;
  return {
    external_id: String(job.id),
    title: job.title,
    url: job.absolute_url,
    location,
    remote_ok: location ? REMOTE_RE.test(location) : null,
    comp_min: null,
    comp_max: null,
    raw: job,
  };
}
