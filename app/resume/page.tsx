import Link from 'next/link';
import { getServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type Profile = {
  resume_pdf_path: string | null;
  resume_text: string | null;
  positioning: string | null;
  updated_at: string;
} | null;

export default async function ResumePage() {
  const db = getServiceClient();
  const [profileRes, _jobCountsRes] = await Promise.all([
    db.from('profiles').select('resume_pdf_path, resume_text, positioning, updated_at').eq('id', 1).maybeSingle(),
    db.rpc('phase3_scored_counts').select().maybeSingle().then(
      (r) => r,
      () => ({ data: null, error: null }),
    ),
  ]);

  const profile: Profile = profileRes.data ?? null;

  // Fallback: compute counts inline if the RPC doesn't exist yet
  let scored = 0;
  let total = 0;
  const counts = await db
    .from('jobs')
    .select('id, fit_scores!left(job_id)', { count: 'exact', head: false })
    .eq('is_active', true)
    .eq('title_matches_role', true);
  if (!counts.error) {
    total = counts.data?.length ?? 0;
    scored = (counts.data ?? []).filter(
      (r: { fit_scores?: unknown[] | null }) => Array.isArray(r.fit_scores) && r.fit_scores.length > 0,
    ).length;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        <Link href="/dashboard" className="hover:text-zinc-600">
          Beacon
        </Link>{' '}
        <span className="text-zinc-400">/ resume</span>
      </h1>

      <section className="mt-8 rounded border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Upload resume PDF</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Max 5 MB. Claude Sonnet extracts the text and stores it. Overwrites any previous resume.
        </p>
        <form
          method="post"
          action="/api/resume/upload"
          encType="multipart/form-data"
          className="mt-4 flex items-center gap-3"
        >
          <input
            type="file"
            name="file"
            accept="application/pdf"
            required
            className="text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white dark:file:bg-zinc-100 dark:file:text-zinc-900"
          />
          <button
            type="submit"
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Upload
          </button>
        </form>
      </section>

      <section className="mt-6 rounded border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Positioning</h2>
        <p className="mt-1 text-sm text-zinc-500">
          A 2-3 sentence frame for how you want to be positioned. Read by every scoring call and every generated cover letter / tailored resume alongside your resume. Change it and hit <em>Save</em>, then click <em>Re-score all</em> to re-rank the 449 candidates against the new framing.
        </p>
        <form method="post" action="/api/positioning" className="mt-3">
          <textarea
            name="positioning"
            rows={4}
            placeholder="e.g. Growth Engineering Manager, specializing in taking small teams to their next stage. Focus on integrating AI into engineering workflows to compress cycle time while preserving quality gates end-to-end."
            defaultValue={profile?.positioning ?? ''}
            className="w-full rounded border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Save positioning
            </button>
            {profile?.positioning && (
              <span className="text-xs text-zinc-500">
                Currently: {profile.positioning.length} chars
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="mt-6 rounded border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Status</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-zinc-500">Resume on file</dt>
            <dd className="mt-1">
              {profile?.resume_text
                ? `${profile.resume_text.length.toLocaleString()} chars, updated ${new Date(profile.updated_at).toISOString().slice(0, 16)}Z`
                : 'None yet'}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Fit-scored EM candidates</dt>
            <dd className="mt-1">
              {scored.toLocaleString()} / {total.toLocaleString()}
            </dd>
          </div>
        </dl>
        {profile?.resume_text && (
          <div className="mt-4 flex flex-wrap gap-3">
            {scored < total && (
              <form method="post" action="/api/score-all">
                <button
                  type="submit"
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
                >
                  Score all {total - scored} unscored
                </button>
              </form>
            )}
            <form method="post" action="/api/score-all?force=1">
              <button
                type="submit"
                className="rounded border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400"
              >
                Re-score all {total} (force)
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
