export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Beacon</h1>
      <p className="mt-4 text-zinc-600 dark:text-zinc-400">
        Job scanner & fit dashboard. Phase 1: fetch pipeline only — dashboard
        arrives in Phase 4.
      </p>
      <p className="mt-6 text-sm text-zinc-500">
        Trigger a scan:{' '}
        <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono dark:bg-white/[.08]">
          curl -X POST -H &quot;authorization: Bearer $CRON_SECRET&quot;
          {' '}http://localhost:3000/api/run-weekly-scan
        </code>
      </p>
    </main>
  );
}
