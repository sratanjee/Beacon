import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServiceClient } from '@/lib/supabase/server';
import { GenerateSection } from './generate-section';

export const dynamic = 'force-dynamic';

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
  companies: { id: number; name: string; notable_lists: string[] | null } | null;
  fit_scores: {
    overall_score: number | null;
    domain_proximity_score: number | null;
    seniority_match_score: number | null;
    comp_signal: string | null;
    rationale: string | null;
  } | null;
  job_states: { is_saved: boolean | null; applied_at: string | null } | null;
};

type GeneratedDoc = { text: string; generated_at: string; model: string };

function formatComp(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'not disclosed';
  const fmt = (n: number) => `$${Math.round(n / 1000)}K`;
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}`;
  if (max != null) return `up to ${fmt(max)}`;
  return `${fmt(min!)}+`;
}

export default async function JobDetail({
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
        'companies!inner(id, name, notable_lists), ' +
        'fit_scores!left(overall_score, domain_proximity_score, seniority_match_score, comp_signal, rationale), ' +
        'job_states!left(is_saved, applied_at)',
    )
    .eq('id', jobId)
    .maybeSingle();
  if (jobRes.error || !jobRes.data) notFound();
  const job = jobRes.data as unknown as JobRow;

  const [coverRes, resumeRes] = await Promise.all([
    db
      .from('generated_docs')
      .select('text, generated_at, model')
      .eq('job_id', jobId)
      .eq('kind', 'cover_letter')
      .maybeSingle(),
    db
      .from('generated_docs')
      .select('text, generated_at, model')
      .eq('job_id', jobId)
      .eq('kind', 'tailored_resume')
      .maybeSingle(),
  ]);
  const cover: GeneratedDoc | null = coverRes.data ?? null;
  const resume: GeneratedDoc | null = resumeRes.data ?? null;

  const fit = job.fit_scores;
  const state = job.job_states;
  const isSaved = !!state?.is_saved;
  const isApplied = !!state?.applied_at;
  const returnTo = `/jobs/${jobId}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header>
        <p className="text-sm text-zinc-500">
          <Link href="/dashboard" className="hover:text-zinc-800 dark:hover:text-zinc-200">
            ← dashboard
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
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
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

      <div className="mt-6 flex flex-wrap items-center gap-3 no-print">
        <form method="post" action={`/api/jobs/${jobId}/state`}>
          <input type="hidden" name="return_to" value={returnTo} />
          <button
            type="submit"
            name="action"
            value="toggle_save"
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isSaved
                ? 'bg-rose-600 text-white'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            {isSaved ? '★ Saved' : '☆ Save'}
          </button>
        </form>
        <form method="post" action={`/api/jobs/${jobId}/state`}>
          <input type="hidden" name="return_to" value={returnTo} />
          <button
            type="submit"
            name="action"
            value={isApplied ? 'unmark_applied' : 'mark_applied'}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isApplied
                ? 'bg-teal-600 text-white'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            }`}
          >
            {isApplied
              ? `✓ Applied ${state?.applied_at?.slice(0, 10)}`
              : '✓ Mark applied'}
          </button>
        </form>
      </div>

      <GenerateSection
        jobId={jobId}
        initialCover={cover}
        initialResume={resume}
      />

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
