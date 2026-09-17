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

function formatComp(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  const fmt = (n: number) => `$${Math.round(n / 1000)}K`;
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}`;
  if (max != null) return `up to ${fmt(max)}`;
  return `${fmt(min!)}+`;
}

export default async function JaredPage() {
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
    .limit(300);

  const raw = (jobsRes.data ?? []) as unknown as Row[];
  const rows = raw
    .map((r) => ({
      ...r,
      score: r.fit_scores?.[0]?.overall_score ?? 0,
      rationale: r.fit_scores?.[0]?.rationale ?? null,
    }))
    .sort((a, b) => b.score - a.score);

  const tier1 = rows.filter((r) => r.score >= 70);
  const tier2 = rows.filter((r) => r.score >= 60 && r.score < 70);
  const tier3 = rows.filter((r) => r.score >= 50 && r.score < 60);

  const Section = ({ title, subtitle, roles }: { title: string; subtitle: string; roles: typeof rows }) => (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
      <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
        {roles.length === 0 && (
          <li className="py-4 text-sm text-zinc-500">Nothing yet in this tier.</li>
        )}
        {roles.map((r) => (
          <li key={r.id} className="flex items-start gap-4 py-3">
            <span
              className={`mt-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${
                r.score >= 75
                  ? 'bg-emerald-700'
                  : r.score >= 65
                    ? 'bg-emerald-600'
                    : r.score >= 55
                      ? 'bg-amber-600'
                      : 'bg-zinc-500'
              }`}
            >
              {r.score}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {r.companies?.name}
                </span>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-700 hover:text-blue-600 hover:underline dark:text-zinc-300 dark:hover:text-blue-400"
                >
                  {r.title}
                </a>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {formatComp(r.comp_min, r.comp_max)}
                {r.location ? ` · ${r.location.slice(0, 80)}` : ''}
                {r.remote_ok === true ? ' · remote-ok' : ''}
              </div>
              {r.rationale && (
                <p className="mt-1 text-xs italic text-zinc-500">{r.rationale}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Jared&apos;s Roles</h1>
        <p className="mt-2 text-sm text-zinc-500">
          {rows.length} matches from Beacon&apos;s crawl, scored against your resume + positioning.
          Sorted by fit. Click any role title to open the application page.
        </p>
        <p className="mt-3 text-xs text-zinc-400">
          Curated by Sarang. Beacon scans 180+ companies weekly for GTM-track leadership roles.
        </p>
      </header>

      <Section
        title="Top picks"
        subtitle="Fit score 70+. Apply to these first — closest match to your CS + strategic-account background."
        roles={tier1}
      />
      <Section
        title="Strong matches"
        subtitle="Fit score 60–69. Worth reviewing — solid alignment with some caveats."
        roles={tier2}
      />
      <Section
        title="Worth a look"
        subtitle="Fit score 50–59. Adjacent roles where your background could translate."
        roles={tier3}
      />

      <footer className="mt-16 border-t border-zinc-200 pt-6 text-xs text-zinc-400 dark:border-zinc-800">
        Feedback? Ping Sarang. New roles surface every Monday (auto-scanned).
      </footer>
    </main>
  );
}
