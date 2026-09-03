import { NormalizedJob } from './types';
import { parseComp } from '@/lib/filter/comp';

function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim() || null;
}

type AshbyLocation = { location?: string | null };

type AshbyJob = {
  id: string;
  title: string;
  jobUrl: string;
  location?: string | null;
  isRemote?: boolean;
  isListed?: boolean;
  secondaryLocations?: AshbyLocation[];
  descriptionHtml?: string;
  descriptionPlain?: string;
};

type AshbyResponse = {
  jobs?: AshbyJob[];
  apiVersion?: string;
};

export async function fetchAshbyJobs(slug: string): Promise<NormalizedJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'beacon-fetcher/0.1 (+https://mybeacon.sh)' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Ashby ${slug}: HTTP ${res.status}`);
  const body = (await res.json()) as AshbyResponse;
  const jobs = (body.jobs ?? []).filter((j) => j.isListed !== false);
  return jobs.map(normalize);
}

function normalize(job: AshbyJob): NormalizedJob {
  const parts = [job.location, ...(job.secondaryLocations ?? []).map((s) => s.location)]
    .filter((s): s is string => Boolean(s && s.trim()));
  const location = parts.length ? [...new Set(parts)].join('; ') : null;
  const { comp_min, comp_max } = parseComp(job.descriptionHtml ?? job.descriptionPlain);
  const { descriptionHtml: _h, descriptionPlain: _p, ...rawWithoutBody } = job;
  return {
    external_id: job.id,
    title: job.title,
    url: job.jobUrl,
    location,
    remote_ok: typeof job.isRemote === 'boolean' ? job.isRemote : null,
    comp_min,
    comp_max,
    raw: rawWithoutBody,
    description_text: job.descriptionPlain?.trim() || htmlToText(job.descriptionHtml),
  };
}
