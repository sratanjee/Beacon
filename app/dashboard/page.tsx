import Link from 'next/link';
import { getServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type SortKey = 'first_seen' | 'company' | 'title' | 'location' | 'comp';
type SearchParams = {
  company?: string;
  remote?: string;
  min_comp?: string;
  ai?: string;
  sort?: SortKey;
  dir?: 'asc' | 'desc';
};

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
};

type CompanyOption = { name: string };

const SORT_COLUMNS: Record<SortKey, string> = {
  first_seen: 'first_seen_at',
  company: 'companies(name)',
  title: 'title',
  location: 'location',
  comp: 'comp_max',
};

const HIGH_COMP_THRESHOLD = 300_000;

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

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const company = params.company?.trim() || null;
  const remoteOnly = params.remote === '1';
  const aiOnly = params.ai === '1';
  const minComp = params.min_comp ? Number.parseInt(params.min_comp, 10) : null;
  const validMinComp = minComp && minComp > 0 && minComp < 2_000_000 ? minComp : null;
  const sort: SortKey = (
    ['first_seen', 'company', 'title', 'location', 'comp'] as const
  ).includes(params.sort as SortKey)
    ? (params.sort as SortKey)
    : 'first_seen';
  const dir: 'asc' | 'desc' = params.dir === 'asc' ? 'asc' : 'desc';

  const db = getServiceClient();

  const companiesRes = await db
    .from('companies')
    .select('name')
    .in('ats_type', ['greenhouse', 'ashby', 'lever'])
    .order('name');
  const companyOptions: CompanyOption[] = (companiesRes.data ?? []) as CompanyOption[];

  let query = db
    .from('jobs')
    .select(
      'id, title, url, location, remote_ok, comp_min, comp_max, first_seen_at, companies!inner(name, notable_lists)',
    )
    .eq('is_active', true)
    .eq('title_matches_role', true);

  if (company) query = query.eq('companies.name', company);
  if (aiOnly) query = query.contains('companies.notable_lists', ['top_ai']);
  if (remoteOnly) query = query.eq('remote_ok', true);
  if (validMinComp) query = query.gte('comp_max', validMinComp);

  if (sort === 'comp') {
    query = query.order('comp_max', { ascending: dir === 'asc', nullsFirst: false });
  } else {
    query = query.order(SORT_COLUMNS[sort], { ascending: dir === 'asc' });
  }
  query = query.limit(500);

  const jobsRes = await query;
  const rows = (jobsRes.data ?? []) as unknown as Row[];

  const sevenDaysAgo = Date.now() - 7 * 86_400_000;

  const linkFor = (next: Partial<SearchParams>) => {
    const sp = new URLSearchParams();
    if (company) sp.set('company', company);
    if (remoteOnly) sp.set('remote', '1');
    if (aiOnly) sp.set('ai', '1');
    if (validMinComp) sp.set('min_comp', validMinComp.toString());
    sp.set('sort', sort);
    sp.set('dir', dir);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === null || v === '') sp.delete(k);
      else sp.set(k, String(v));
    }
    return `/dashboard?${sp.toString()}`;
  };

  const sortLink = (key: SortKey, label: string) => {
    const active = sort === key;
    const nextDir = active && dir === 'desc' ? 'asc' : 'desc';
    return (
      <Link
        href={linkFor({ sort: key, dir: nextDir })}
        className={`hover:text-zinc-900 dark:hover:text-zinc-100 ${
          active ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500'
        }`}
      >
        {label}
        {active ? (dir === 'desc' ? ' ↓' : ' ↑') : ''}
      </Link>
    );
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            <Link href="/" className="hover:text-zinc-600">
              Beacon
            </Link>{' '}
            <span className="text-zinc-400">/ dashboard</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {rows.length} EM candidates
            {aiOnly ? ' at AI-native companies' : ''}
            {company ? ` at ${company}` : ''}
            {remoteOnly ? ', remote only' : ''}
            {validMinComp ? `, ≥ $${Math.round(validMinComp / 1000)}K comp` : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={linkFor({ ai: aiOnly ? '' : '1' })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                aiOnly
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              🤖 Top AI
            </Link>
            <Link
              href={linkFor({
                min_comp: validMinComp === HIGH_COMP_THRESHOLD ? '' : HIGH_COMP_THRESHOLD.toString(),
              })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                validMinComp === HIGH_COMP_THRESHOLD
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              💎 $300K+
            </Link>
            <Link
              href={linkFor({ remote: remoteOnly ? '' : '1' })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                remoteOnly
                  ? 'bg-sky-600 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              🌍 Remote
            </Link>
          </div>
        </div>
      </div>

      <form
        method="get"
        action="/dashboard"
        className="mt-6 flex flex-wrap items-center gap-4 text-sm"
      >
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        {aiOnly && <input type="hidden" name="ai" value="1" />}
        <label className="flex items-center gap-2">
          <span className="text-zinc-500">Company</span>
          <select
            name="company"
            defaultValue={company ?? ''}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All</option>
            {companyOptions.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="remote"
            value="1"
            defaultChecked={remoteOnly}
            className="rounded"
          />
          <span className="text-zinc-500">Remote only</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-zinc-500">Min comp</span>
          <select
            name="min_comp"
            defaultValue={validMinComp?.toString() ?? ''}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Any</option>
            <option value="200000">$200K+</option>
            <option value="300000">$300K+</option>
            <option value="400000">$400K+</option>
            <option value="500000">$500K+</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Apply
        </button>
        {(company || remoteOnly || validMinComp || aiOnly) && (
          <Link href={`/dashboard?sort=${sort}&dir=${dir}`} className="text-zinc-500 underline">
            Clear
          </Link>
        )}
      </form>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="py-2 pr-4 font-medium">{sortLink('company', 'Company')}</th>
              <th className="py-2 pr-4 font-medium">{sortLink('title', 'Title')}</th>
              <th className="py-2 pr-4 font-medium">{sortLink('location', 'Location')}</th>
              <th className="py-2 pr-4 font-medium">Remote</th>
              <th className="py-2 pr-4 font-medium">{sortLink('comp', 'Comp')}</th>
              <th className="py-2 pr-4 font-medium">{sortLink('first_seen', 'First seen')}</th>
              <th className="py-2 pr-4 font-medium"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-zinc-500">
                  No matches. Clear filters or wait for the next weekly scan.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const days = daysAgo(row.first_seen_at);
              const isNew = new Date(row.first_seen_at).getTime() > sevenDaysAgo;
              const isTopAi = row.companies?.notable_lists?.includes('top_ai');
              const isHighComp = (row.comp_max ?? 0) >= HIGH_COMP_THRESHOLD;
              return (
                <tr key={row.id} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                    {row.companies?.name ?? '—'}
                    {isTopAi && (
                      <span className="ml-1.5 text-[10px]" title="Top AI company">
                        🤖
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {row.title}
                    {isNew && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        new
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-zinc-500">{row.location ?? '—'}</td>
                  <td className="py-2 pr-4 text-zinc-500">
                    {row.remote_ok === true ? 'yes' : row.remote_ok === false ? 'no' : '—'}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4">
                    <span
                      className={
                        isHighComp
                          ? 'font-medium text-emerald-700 dark:text-emerald-400'
                          : 'text-zinc-500'
                      }
                    >
                      {formatComp(row.comp_min, row.comp_max)}
                    </span>
                    {isHighComp && <span className="ml-1.5 text-[10px]">💎</span>}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-4 text-zinc-500">
                    {days === 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`}
                  </td>
                  <td className="py-2 pr-4">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Open →
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
