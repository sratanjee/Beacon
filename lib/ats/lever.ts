import { NormalizedJob } from './types';

type LeverCategories = {
  commitment?: string;
  location?: string;
  team?: string;
  allLocations?: string[];
};

type LeverPosting = {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: LeverCategories;
  workplaceType?: 'on-site' | 'hybrid' | 'remote' | string;
};

const REMOTE_LOCATION_RE = /\b(remote|anywhere|distributed)\b/i;

export async function fetchLeverJobs(slug: string): Promise<NormalizedJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'beacon-fetcher/0.1 (+https://mybeacon.sh)' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Lever ${slug}: HTTP ${res.status}`);
  const body = (await res.json()) as LeverPosting[];
  return body.map(normalize);
}

function normalize(job: LeverPosting): NormalizedJob {
  const cats = job.categories ?? {};
  const locs = cats.allLocations?.length ? cats.allLocations : cats.location ? [cats.location] : [];
  const location = locs.length ? [...new Set(locs)].join('; ') : null;
  const remote =
    job.workplaceType === 'remote'
      ? true
      : job.workplaceType === 'on-site'
        ? false
        : location
          ? REMOTE_LOCATION_RE.test(location)
          : null;
  return {
    external_id: job.id,
    title: job.text,
    url: job.hostedUrl,
    location,
    remote_ok: remote,
    comp_min: null,
    comp_max: null,
    raw: job,
  };
}
