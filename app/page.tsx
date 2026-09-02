import { getServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const db = getServiceClient();

  const [activeRes, matchRes, runRes, companyRes] = await Promise.all([
    db.from('jobs').select('*', { count: 'exact', head: true }).eq('is_active', true),
    db
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('title_matches_role', true),
    db.from('fetch_runs').select('run_at').order('id', { ascending: false }).limit(1).maybeSingle(),
    db.from('companies').select('*', { count: 'exact', head: true }).in('ats_type', ['greenhouse', 'ashby', 'lever']),
  ]);

  const active = activeRes.count ?? 0;
  const matched = matchRes.count ?? 0;
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
          <dt className="text-zinc-500 dark:text-zinc-400">EM candidates</dt>
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

      <p className="mt-14 text-xs text-zinc-400">
        {lastRun
          ? `Last refreshed ${lastRun.toISOString().slice(0, 16).replace('T', ' ')} UTC.`
          : 'Not yet refreshed.'}
      </p>
    </main>
  );
}
