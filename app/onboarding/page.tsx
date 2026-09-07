import Link from 'next/link';
import { requireUser } from '@/lib/auth/user';
import { ROLE_PACKS } from '@/lib/roles/packs';
import { getServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Onboarding() {
  const user = await requireUser();
  const db = getServiceClient();
  const profileRes = await db
    .from('users')
    .select('role_pack, resume_text, positioning')
    .eq('id', user.id)
    .maybeSingle();

  // If everything is filled, jump to dashboard.
  if (profileRes.data?.role_pack && profileRes.data?.resume_text && profileRes.data?.positioning) {
    redirect('/dashboard');
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Welcome to Beacon</h1>
      <p className="mt-2 text-sm text-zinc-500">Three quick steps and you&apos;re in.</p>

      <section className="mt-8 rounded border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">1. Pick a role pack</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Determines which job titles show up in your dashboard.
        </p>
        <form method="post" action="/api/onboarding" className="mt-4 space-y-2">
          {ROLE_PACKS.map((p) => (
            <label
              key={p.id}
              className="flex items-start gap-3 rounded border border-zinc-200 p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/40"
            >
              <input
                type="radio"
                name="role_pack"
                value={p.id}
                defaultChecked={profileRes.data?.role_pack === p.id}
                required
                className="mt-1"
              />
              <div>
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-xs text-zinc-500">{p.description}</div>
              </div>
            </label>
          ))}
          <button
            type="submit"
            className="mt-2 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Save role pack
          </button>
        </form>
      </section>

      <section className="mt-6 rounded border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">2. Upload resume (PDF)</h2>
        <p className="mt-1 text-sm text-zinc-500">Max 5 MB. Claude extracts the text.</p>
        <form
          method="post"
          action="/api/resume/upload"
          encType="multipart/form-data"
          className="mt-4 flex items-center gap-3"
        >
          <input type="file" name="file" accept="application/pdf" required className="text-sm" />
          <button
            type="submit"
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Upload
          </button>
        </form>
        {profileRes.data?.resume_text && (
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
            ✓ Resume on file ({profileRes.data.resume_text.length} chars)
          </p>
        )}
      </section>

      <section className="mt-6 rounded border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">3. Positioning (2-3 sentences)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          How you want to be positioned — read by every scoring + generation call.
        </p>
        <form method="post" action="/api/positioning" className="mt-4">
          <input type="hidden" name="return_to" value="/dashboard" />
          <textarea
            name="positioning"
            rows={4}
            placeholder="e.g. Growth Engineering Manager, taking small teams to their next stage of growth, focused on AI-augmented workflows with quality gates end-to-end."
            defaultValue={profileRes.data?.positioning ?? ''}
            className="w-full rounded border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="mt-2 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Save positioning & finish
          </button>
        </form>
      </section>

      <p className="mt-8 text-center text-xs text-zinc-500">
        Done all three?{' '}
        <Link href="/dashboard" className="underline">
          Go to your dashboard →
        </Link>
      </p>
    </main>
  );
}
