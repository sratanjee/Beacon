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
  description?: string;
  descriptionPlain?: string;
  additional?: string;
  additionalPlain?: string;
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
  const compText = [job.description, job.descriptionPlain, job.additional, job.additionalPlain]
    .filter(Boolean)
    .join(' ');
  const { comp_min, comp_max } = parseComp(compText);
  const {
    description: _d,
    descriptionPlain: _dp,
    additional: _a,
    additionalPlain: _ap,
    ...rawWithoutBody
  } = job;
  return {
    external_id: job.id,
    title: job.text,
    url: job.hostedUrl,
    location,
    remote_ok: remote,
    comp_min,
    comp_max,
    raw: rawWithoutBody,
    description_text:
      job.descriptionPlain?.trim() ||
      (job.additionalPlain?.trim() ? job.additionalPlain.trim() : null) ||
      htmlToText([job.description, job.additional].filter(Boolean).join(' ')),
  };
}
