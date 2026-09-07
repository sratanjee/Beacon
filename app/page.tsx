import Link from 'next/link';
import { getServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const db = getServiceClient();

  // "Matched" = distinct active jobs with ≥ 1 role_pack match across any pack.
  // Pull the ids in one round-trip and uniquify in memory (~2k rows max).
  const [activeRes, matchIdsRes, runRes, companyRes] = await Promise.all([
    db.from('jobs').select('*', { count: 'exact', head: true }).eq('is_active', true),
    db
      .from('job_role_matches')
      .select('job_id, jobs!inner(is_active)')
      .eq('jobs.is_active', true),
    db.from('fetch_runs').select('run_at').order('id', { ascending: false }).limit(1).maybeSingle(),
    db.from('companies').select('*', { count: 'exact', head: true }).in('ats_type', ['greenhouse', 'ashby', 'lever']),
  ]);

  const active = activeRes.count ?? 0;
  const matched = new Set(
    (matchIdsRes.data ?? []).map((r: { job_id: number }) => r.job_id),
  ).size;
  const companies = companyRes.count ?? 0;
  const lastRun = runRes.data?.run_at ? new Date(runRes.data.run_at) : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Beacon</h1>
      <p className="mt-3 text-zinc-500 dark:text-zinc-400">
        Weekly scanner for Engineering Manager / Head of Eng / Director of Eng roles.
      </p>

      <dl className="mt-14 grid grid-cols-3 gap-8 text-sm">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Matched roles</dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums">
            {matched.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Roles tracked</dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums">
            {active.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Companies</dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums">
            {companies.toLocaleString()}
          </dd>
        </div>
      </dl>

      <div className="mt-10">
        <Link
          href="/dashboard"
          className="inline-flex items-center rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Open dashboard →
        </Link>
      </div>

      <p className="mt-14 text-xs text-zinc-400">
        {lastRun
          ? `Last refreshed ${lastRun.toISOString().slice(0, 16).replace('T', ' ')} UTC.`
          : 'Not yet refreshed.'}
      </p>
    </main>
  );
}
