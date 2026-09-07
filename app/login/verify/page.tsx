export const dynamic = 'force-dynamic';

export default async function VerifyOtp({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Beacon</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Enter the 6-digit code you were sent.
      </p>
      <form method="post" action="/api/auth/verify-otp" className="mt-8 space-y-3">
        <input
          type="email"
          name="email"
          required
          defaultValue={params.email ?? ''}
          placeholder="you@example.com"
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="text"
          name="token"
          required
          inputMode="numeric"
          pattern="\d{6}"
          autoFocus
          maxLength={6}
          placeholder="6-digit code"
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-center text-lg tracking-widest tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Sign in
        </button>
        {params.error === '1' && (
          <p className="text-sm text-red-600 dark:text-red-400">
            That code didn&apos;t work. It may be expired — ask for a new one.
          </p>
        )}
      </form>
      <p className="mt-6 text-xs text-zinc-500">
        <a href="/login" className="hover:text-zinc-800 dark:hover:text-zinc-300">
          ← back to email login
        </a>
      </p>
    </main>
  );
}
