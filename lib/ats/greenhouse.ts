import { NormalizedJob } from './types';
import { parseComp } from '@/lib/filter/comp';

type GreenhouseLocation = { name?: string | null };

type GreenhouseJob = {
  id: number;
  title: string;
  absolute_url: string;
  location?: GreenhouseLocation | null;
  content?: string;
  updated_at?: string;
  first_published?: string;
};

type GreenhouseResponse = {
  jobs?: GreenhouseJob[];
  meta?: { total?: number };
};

const REMOTE_RE = /\b(remote|anywhere|distributed|work[\s-]?from[\s-]?home)\b/i;

export async function fetchGreenhouseJobs(slug: string): Promise<NormalizedJob[]> {
  // ?content=true pulls the full HTML description — needed to parse the
  // pay-transparency comp band embedded in the posting.
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
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
  const { comp_min, comp_max } = parseComp(job.content);
  // Don't persist the full HTML in `raw` — it's ~10KB per job × 15k jobs.
  // Comp already extracted; downstream doesn't need the description body.
  const { content: _content, ...rawWithoutContent } = job;
  return {
    external_id: String(job.id),
    title: job.title,
    url: job.absolute_url,
    location,
    remote_ok: location ? REMOTE_RE.test(location) : null,
    comp_min,
    comp_max,
    raw: rawWithoutContent,
  };
}
