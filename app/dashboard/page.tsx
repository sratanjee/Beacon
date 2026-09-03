import Link from 'next/link';
import { getServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type SortKey = 'first_seen' | 'company' | 'title' | 'comp';
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

const SORT_COLUMNS: Record<SortKey, string> = {
  first_seen: 'first_seen_at',
  company: 'companies(name)',
  title: 'title',
  comp: 'comp_max',
};

const HIGH_COMP = 300_000;

function formatComp(min: number | null, max: number | null): string {
  if (min == null && max == null) return '';
  const fmt = (n: number) => `$${Math.round(n / 1000)}K`;
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}`;
  if (max != null) return `up to ${fmt(max)}`;
  return `${fmt(min!)}+`;
}

function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return '1d';
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${Math.round(d / 365)}y`;
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
  const sort: SortKey = (['first_seen', 'company', 'title', 'comp'] as const).includes(
    params.sort as SortKey,
  )
    ? (params.sort as SortKey)
    : 'first_seen';
  const dir: 'asc' | 'desc' = params.dir === 'asc' ? 'asc' : 'desc';

  const db = getServiceClient();

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

  const chip = (label: string, active: boolean, href: string, activeClass: string) => (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? activeClass
          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-800'
      }`}
    >
      {label}
    </Link>
  );

  const anyFilter = aiOnly || remoteOnly || validMinComp || company;

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="flex items-baseline justify-between">
        <Link
          href="/"
          className="text-2xl font-semibold tracking-tight text-zinc-900 hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300"
        >
          Beacon
        </Link>
        <span className="text-xs tabular-nums text-zinc-400">
          {rows.length.toLocaleString()} roles
        </span>
      </header>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {chip(
          '🤖 Top AI',
          aiOnly,
          linkFor({ ai: aiOnly ? '' : '1' }),
          'bg-violet-600 text-white',
        )}
        {chip(
          '💎 $300K+',
          !!(validMinComp && validMinComp >= HIGH_COMP),
          linkFor({ min_comp: validMinComp === HIGH_COMP ? '' : HIGH_COMP.toString() }),
          'bg-emerald-600 text-white',
        )}
        {chip(
          '🌍 Remote',
          remoteOnly,
          linkFor({ remote: remoteOnly ? '' : '1' }),
          'bg-sky-600 text-white',
        )}
        {company &&
          chip(
            `${company} ×`,
            true,
            linkFor({ company: '' }),
            'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900',
          )}
        {anyFilter && (
          <Link
            href={`/dashboard?sort=${sort}&dir=${dir}`}
            className="ml-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            clear all
          </Link>
        )}
      </div>

      <div className="mt-10 -mx-2 overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-2 py-16 text-center text-sm text-zinc-400">
            No roles match. Try clearing a filter.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((row) => {
              const isNew = new Date(row.first_seen_at).getTime() > sevenDaysAgo;
              const isTopAi = row.companies?.notable_lists?.includes('top_ai');
              const isHighComp = (row.comp_max ?? 0) >= HIGH_COMP;
              const comp = formatComp(row.comp_min, row.comp_max);
              return (
                <li key={row.id}>
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-4 px-2 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {row.companies?.name ?? '—'}
                        </span>
                        {isTopAi && <span className="text-[10px]">🤖</span>}
                        {isNew && (
                          <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                            new
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
                        {row.title}
                      </div>
                      {row.location && (
                        <div className="mt-0.5 truncate text-xs text-zinc-400">
                          {row.location}
                          {row.remote_ok && ' · remote'}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-0.5 whitespace-nowrap text-xs">
                      {comp && (
                        <span
                          className={
                            isHighComp
                              ? 'font-medium text-emerald-700 dark:text-emerald-400'
                              : 'text-zinc-500'
                          }
                        >
                          {comp}
                          {isHighComp && ' 💎'}
                        </span>
                      )}
                      <span className="text-zinc-400">{daysAgo(row.first_seen_at)}</span>
                    </div>

                    <span className="text-zinc-300 group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-500">
                      ↗
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="mt-16 flex items-center justify-between text-xs text-zinc-400">
        <span>
          sort:{' '}
          <Link
            href={linkFor({ sort: 'first_seen', dir: 'desc' })}
            className={sort === 'first_seen' ? 'text-zinc-700 dark:text-zinc-300' : 'hover:underline'}
          >
            newest
          </Link>
          {' · '}
          <Link
            href={linkFor({ sort: 'comp', dir: 'desc' })}
            className={sort === 'comp' ? 'text-zinc-700 dark:text-zinc-300' : 'hover:underline'}
          >
            comp
          </Link>
          {' · '}
          <Link
            href={linkFor({ sort: 'company', dir: 'asc' })}
            className={sort === 'company' ? 'text-zinc-700 dark:text-zinc-300' : 'hover:underline'}
          >
            company
          </Link>
        </span>
        <span>weekly refresh · mon 08:00 UTC</span>
      </footer>
    </main>
  );
}
