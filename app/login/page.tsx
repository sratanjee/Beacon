export const dynamic = 'force-dynamic';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const showError = params.error === '1';
  const next = params.next ?? '/dashboard';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Beacon</h1>
      <p className="mt-2 text-sm text-zinc-500">Private site — enter password.</p>
      <form method="post" action="/api/login" className="mt-8 space-y-3">
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="password"
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Continue
        </button>
        {showError && (
          <p className="text-sm text-red-600 dark:text-red-400">Wrong password.</p>
        )}
      </form>
    </main>
  );
}
