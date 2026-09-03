'use client';

import { useState } from 'react';

type Props = {
  companyId: number;
  name: string;
  initialSummary: string | null;
};

export function CompanySummaryCard({ companyId, name, initialSummary }: Props) {
  const [summary, setSummary] = useState<string | null>(initialSummary);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async (force: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/companies/${companyId}/summary${force ? '?force=1' : ''}`,
        { method: 'POST' },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed');
      setSummary(body.summary);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium">About {name}</h2>
        <button
          onClick={() => generate(!!summary)}
          disabled={busy}
          className="text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
        >
          {busy ? 'generating…' : summary ? 'regenerate' : 'generate'}
        </button>
      </div>
      {err && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">{err}</p>
      )}
      {summary ? (
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{summary}</p>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">
          Click generate — 2-3 sentence company blurb from Claude Sonnet (~$0.005).
        </p>
      )}
    </div>
  );
}
