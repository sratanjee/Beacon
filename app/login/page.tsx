export const dynamic = 'force-dynamic';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Beacon</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Private site. Enter your email to receive a login link.
      </p>
      <form method="post" action="/api/auth/request-link" className="mt-8 space-y-3">
        <input
          type="email"
          name="email"
          autoFocus
          required
          placeholder="you@example.com"
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Send link
        </button>
        {params.sent === '1' && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            If that email is invited, a login link is on its way.
          </p>
        )}
        {params.error === '1' && (
          <p className="text-sm text-red-600 dark:text-red-400">Something went wrong. Try again.</p>
        )}
      </form>
    </main>
  );
}
