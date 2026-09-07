import { requireAdmin } from '@/lib/auth/user';
import { getServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Invites() {
  const admin = await requireAdmin();
  const db = getServiceClient();
  const [invitesRes, usersRes] = await Promise.all([
    db.from('invited_emails').select('email, invited_at').order('invited_at', { ascending: false }),
    db
      .from('users')
      .select('id, email, display_name, role_pack, resume_text, created_at')
      .order('created_at', { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Admin — Invites</h1>
      <p className="mt-1 text-sm text-zinc-500">Logged in as {admin.email}</p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Add invite</h2>
        <form method="post" action="/api/admin/invites" className="mt-2 flex gap-2">
          <input
            type="email"
            name="email"
            required
            placeholder="friend@example.com"
            className="flex-1 rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Invite
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Invited ({invitesRes.data?.length ?? 0})
        </h2>
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {(invitesRes.data ?? []).map((i) => (
            <li key={i.email} className="flex items-center justify-between py-2 text-sm">
              <span>{i.email}</span>
              <form
                method="post"
                action={`/api/admin/invites?email=${encodeURIComponent(i.email)}&_method=delete`}
              >
                <button
                  type="submit"
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                >
                  revoke
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Users ({usersRes.data?.length ?? 0})
        </h2>
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {(usersRes.data ?? []).map((u) => (
            <li key={u.id} className="py-2 text-sm">
              <div>
                {u.email} · <span className="text-zinc-500">{u.role_pack ?? 'onboarding'}</span> ·{' '}
                {u.resume_text ? 'resume ✓' : 'no resume'}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
