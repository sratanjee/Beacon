import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServiceClient } from '@/lib/supabase/server';
import { JaredGenerate } from './generate-section';

export const dynamic = 'force-dynamic';

const JARED_UID = '200c0b73-da1a-446f-b833-daa44d218ec6';

type JobRow = {
  id: number;
  title: string;
  url: string;
  location: string | null;
  remote_ok: boolean | null;
  comp_min: number | null;
  comp_max: number | null;
  first_seen_at: string;
  description_text: string | null;
  companies: { name: string; notable_lists: string[] | null } | null;
  fit_scores: Array<{
    overall_score: number | null;
    domain_proximity_score: number | null;
    seniority_match_score: number | null;
    comp_signal: string | null;
    rationale: string | null;
  }>;
};

type Doc = { text: string; generated_at: string; model: string };

function formatComp(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'not disclosed';
  const fmt = (n: number) => `$${Math.round(n / 1000)}K`;
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}`;
  if (max != null) return `up to ${fmt(max)}`;
  return `${fmt(min!)}+`;
}

export default async function JaredJobDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const jobId = Number.parseInt(id, 10);
  if (!Number.isFinite(jobId)) notFound();

  const db = getServiceClient();
  const jobRes = await db
    .from('jobs')
    .select(
      'id, title, url, location, remote_ok, comp_min, comp_max, first_seen_at, description_text, ' +
        'companies!inner(name, notable_lists), ' +
        'fit_scores!left(overall_score, domain_proximity_score, seniority_match_score, comp_signal, rationale)',
    )
    .eq('id', jobId)
    .eq('fit_scores.user_id', JARED_UID)
    .maybeSingle();
  if (jobRes.error || !jobRes.data) notFound();
  const job = jobRes.data as unknown as JobRow;
  const fit = job.fit_scores?.[0] ?? null;

  const [coverRes, resumeRes] = await Promise.all([
    db
      .from('generated_docs')
      .select('text, generated_at, model')
      .eq('job_id', jobId)
      .eq('kind', 'cover_letter')
      .eq('user_id', JARED_UID)
      .maybeSingle(),
    db
      .from('generated_docs')
      .select('text, generated_at, model')
      .eq('job_id', jobId)
      .eq('kind', 'tailored_resume')
      .eq('user_id', JARED_UID)
      .maybeSingle(),
  ]);
  const cover: Doc | null = coverRes.data ?? null;
  const resume: Doc | null = resumeRes.data ?? null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header>
        <p className="text-sm text-zinc-500">
          <Link href="/jared" className="hover:text-zinc-800 dark:hover:text-zinc-200">
            ← all roles
          </Link>
        </p>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {job.companies?.name}
              {job.location ? ` · ${job.location}` : ''}
              {job.remote_ok === true ? ' · remote-ok' : ''}
            </p>
          </div>
          {fit?.overall_score != null && (
            <div className="whitespace-nowrap text-right">
              <div className="text-3xl font-semibold tabular-nums">{fit.overall_score}</div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">Fit</div>
            </div>
          )}
        </div>
      </header>

      <dl className="mt-6 grid grid-cols-3 gap-4 rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div>
          <dt className="text-zinc-500">Comp</dt>
          <dd className="mt-1 font-medium">{formatComp(job.comp_min, job.comp_max)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">First seen</dt>
          <dd className="mt-1 font-medium">{new Date(job.first_seen_at).toISOString().slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Apply</dt>
          <dd className="mt-1">
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
              Open on ATS ↗
            </a>
          </dd>
        </div>
      </dl>

      {fit?.rationale && (
        <blockquote className="mt-6 border-l-2 border-zinc-300 pl-4 text-sm italic text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {fit.rationale}
        </blockquote>
      )}

      <JaredGenerate jobId={jobId} initialCover={cover} initialResume={resume} />

      {job.description_text && (
        <details className="mt-10 rounded border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
            Job description ({job.description_text.length.toLocaleString()} chars)
          </summary>
          <pre className="whitespace-pre-wrap px-4 pb-4 text-xs text-zinc-600 dark:text-zinc-400">
            {job.description_text}
          </pre>
        </details>
      )}
    </main>
  );
}
