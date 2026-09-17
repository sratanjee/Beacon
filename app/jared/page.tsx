import Link from 'next/link';
import { getServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const JARED_UID = '200c0b73-da1a-446f-b833-daa44d218ec6';

type Row = {
  id: number;
  title: string;
  url: string;
  location: string | null;
  remote_ok: boolean | null;
  comp_min: number | null;
  comp_max: number | null;
  first_seen_at: string;
  companies: { name: string; notable_lists: string[] | null } | null;
  fit_scores: Array<{ overall_score: number | null; rationale: string | null }>;
};

type SearchParams = {
  tier?: 'top' | 'strong' | 'look';
  company?: string;
  remote?: string;
};

function formatComp(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  const fmt = (n: number) => `$${Math.round(n / 1000)}K`;
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}`;
  if (max != null) return `up to ${fmt(max)}`;
  return `${fmt(min!)}+`;
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default async function JaredPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tier = params.tier;
  const company = params.company?.trim() || null;
  const remoteOnly = params.remote === '1';

  const db = getServiceClient();
  const jobsRes = await db
    .from('jobs')
    .select(
      'id, title, url, location, remote_ok, comp_min, comp_max, first_seen_at, ' +
        'companies!inner(name, notable_lists), ' +
        'fit_scores!inner(overall_score, rationale), ' +
        'job_role_matches!inner(role_pack)',
    )
    .eq('is_active', true)
    .eq('job_role_matches.role_pack', 'gtm')
    .eq('fit_scores.user_id', JARED_UID)
    .gte('fit_scores.overall_score', 50)
    .limit(500);

  let raw = (jobsRes.data ?? []) as unknown as Row[];
  raw = raw
    .map((r) => ({
      ...r,
      score: r.fit_scores?.[0]?.overall_score ?? 0,
      rationale: r.fit_scores?.[0]?.rationale ?? null,
    }))
    .sort((a, b) => b.score - a.score);

  if (tier === 'top') raw = raw.filter((r) => r.score >= 70);
  else if (tier === 'strong') raw = raw.filter((r) => r.score >= 60 && r.score < 70);
  else if (tier === 'look') raw = raw.filter((r) => r.score >= 50 && r.score < 60);
  if (company) raw = raw.filter((r) => r.companies?.name === company);
  if (remoteOnly) raw = raw.filter((r) => r.remote_ok === true);

  const totalTop = (jobsRes.data ?? []).filter((r: any) => (r.fit_scores?.[0]?.overall_score ?? 0) >= 70).length;
  const totalStrong = (jobsRes.data ?? []).filter((r: any) => {
    const s = r.fit_scores?.[0]?.overall_score ?? 0;
    return s >= 60 && s < 70;
  }).length;
  const totalLook = (jobsRes.data ?? []).filter((r: any) => {
    const s = r.fit_scores?.[0]?.overall_score ?? 0;
    return s >= 50 && s < 60;
  }).length;

  const uniqueCompanies = [
    ...new Set(raw.map((r) => r.companies?.name).filter(Boolean) as string[]),
  ].sort();

  const linkFor = (next: Partial<SearchParams>) => {
    const sp = new URLSearchParams();
    if (tier) sp.set('tier', tier);
    if (company) sp.set('company', company);
    if (remoteOnly) sp.set('remote', '1');
    for (const [k, v] of Object.entries(next)) {
      if (!v) sp.delete(k);
      else sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `/jared?${s}` : '/jared';
  };

  const chip = (active: boolean, className: string) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? className
        : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
    }`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Jared&apos;s Roles</h1>
        <p className="mt-2 text-sm text-zinc-500">
          {raw.length} showing / {totalTop + totalStrong + totalLook} total matches scored against your resume + positioning. Click a role to open the JD or generate a tailored cover letter + resume.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={linkFor({ tier: tier === 'top' ? '' : 'top' })} className={chip(tier === 'top', 'bg-emerald-700 text-white')}>
            ⭐ Top picks ({totalTop})
          </Link>
          <Link href={linkFor({ tier: tier === 'strong' ? '' : 'strong' })} className={chip(tier === 'strong', 'bg-emerald-600 text-white')}>
            Strong matches ({totalStrong})
          </Link>
          <Link href={linkFor({ tier: tier === 'look' ? '' : 'look' })} className={chip(tier === 'look', 'bg-amber-600 text-white')}>
            Worth a look ({totalLook})
          </Link>
          <Link href={linkFor({ remote: remoteOnly ? '' : '1' })} className={chip(remoteOnly, 'bg-sky-600 text-white')}>
            🌍 Remote
          </Link>
          {(tier || company || remoteOnly) && (
            <Link href="/jared" className="text-xs text-zinc-500 underline self-center">
              Clear
            </Link>
          )}
        </div>

        {uniqueCompanies.length > 1 && (
          <form method="get" action="/jared" className="mt-3 flex items-center gap-2 text-sm">
            {tier && <input type="hidden" name="tier" value={tier} />}
            {remoteOnly && <input type="hidden" name="remote" value="1" />}
            <label className="flex items-center gap-2">
              <span className="text-zinc-500">Company</span>
              <select name="company" defaultValue={company ?? ''} className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
                <option value="">All</option>
                {uniqueCompanies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded bg-zinc-900 px-3 py-1 text-white text-xs dark:bg-zinc-100 dark:text-zinc-900">
              Apply
            </button>
          </form>
        )}
      </header>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="py-2 pr-3 font-medium">Fit</th>
              <th className="py-2 pr-4 font-medium">Company</th>
              <th className="py-2 pr-4 font-medium">Title</th>
              <th className="py-2 pr-4 font-medium">Location</th>
              <th className="py-2 pr-4 font-medium">Comp</th>
              <th className="py-2 pr-4 font-medium">First seen</th>
              <th className="py-2 pr-2 font-medium"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {raw.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-zinc-500">
                  No matches. Clear filters.
                </td>
              </tr>
            )}
            {raw.map((row: any) => {
              const days = daysAgo(row.first_seen_at);
              const s = row.score as number;
              const badgeBg =
                s >= 80 ? 'bg-emerald-700' : s >= 70 ? 'bg-emerald-600' : s >= 60 ? 'bg-amber-600' : 'bg-zinc-500';
              return (
                <tr key={row.id} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${badgeBg}`} title={row.rationale ?? undefined}>
                      {s}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                    {row.companies?.name ?? '—'}
                  </td>
                  <td className="py-2 pr-4">
                    <Link href={`/jared/${row.id}`} className="text-zinc-900 hover:text-blue-600 hover:underline dark:text-zinc-100 dark:hover:text-blue-400">
                      {row.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-zinc-500">{row.location ?? '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                    {formatComp(row.comp_min, row.comp_max)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-zinc-500">
                    {days === 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-2">
                    <Link href={`/jared/${row.id}`} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                      Open →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="mt-16 border-t border-zinc-200 pt-6 text-xs text-zinc-400 dark:border-zinc-800">
        Curated by Sarang · Beacon scans 180+ companies weekly for GTM-track leadership roles · Feedback? Ping Sarang.
      </footer>
    </main>
  );
}
