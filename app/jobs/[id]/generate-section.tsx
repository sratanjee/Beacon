'use client';

import { useState } from 'react';

type Doc = { text: string; generated_at: string; model: string };

type Props = {
  jobId: number;
  initialCover: Doc | null;
  initialResume: Doc | null;
};

export function GenerateSection({ jobId, initialCover, initialResume }: Props) {
  return (
    <div className="mt-10 space-y-8">
      <ArtifactPanel
        jobId={jobId}
        kind="cover_letter"
        label="Cover letter"
        initial={initialCover}
      />
      <ArtifactPanel
        jobId={jobId}
        kind="tailored_resume"
        label="Tailored resume"
        initial={initialResume}
      />
    </div>
  );
}

function ArtifactPanel({
  jobId,
  kind,
  label,
  initial,
}: {
  jobId: number;
  kind: 'cover_letter' | 'tailored_resume';
  label: string;
  initial: Doc | null;
}) {
  const [doc, setDoc] = useState<Doc | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async (force: boolean) => {
    setBusy(true);
    setErr(null);
    setCopied(false);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/generate?kind=${kind}${force ? '&force=1' : ''}`,
        { method: 'POST' },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed');
      setDoc({ text: body.text, generated_at: body.generated_at, model: body.model });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!doc) return;
    await navigator.clipboard.writeText(doc.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="rounded border border-zinc-200 dark:border-zinc-800">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h2 className="text-sm font-medium">{label}</h2>
        <div className="flex items-center gap-2 text-xs">
          {doc && (
            <span className="text-zinc-500">
              {new Date(doc.generated_at).toISOString().slice(0, 16).replace('T', ' ')}
            </span>
          )}
          {doc && (
            <button
              onClick={copy}
              className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {copied ? 'copied' : 'copy'}
            </button>
          )}
          <button
            onClick={() => generate(!!doc)}
            disabled={busy}
            className="rounded bg-zinc-900 px-2 py-0.5 text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {busy ? 'generating…' : doc ? 'regenerate' : 'generate'}
          </button>
        </div>
      </header>
      {err && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          {err}
        </p>
      )}
      {doc ? (
        <pre className="whitespace-pre-wrap px-4 py-4 text-sm text-zinc-700 dark:text-zinc-300">
          {doc.text}
        </pre>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-zinc-500">
          Not generated yet. Click generate — takes ~10s and costs ~$0.02.
        </p>
      )}
    </section>
  );
}
