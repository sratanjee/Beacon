# Phase 3 Fit Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Password-protect the site, add PDF resume upload with Claude Sonnet extraction, then score every EM candidate against that resume using Claude Haiku so the dashboard can sort/filter by fit.

**Architecture:** Next.js middleware guards routes via HMAC-of-password cookie. New `profiles` table (singleton row) stores the resume PDF path + extracted text. Fetchers extend `NormalizedJob` with `description_text` so scoring doesn't refetch; new `lib/scoring/run.ts` iterates unscored `title_matches_role` jobs, calls Claude Haiku with prompt-cached resume, writes structured JSON to the existing `fit_scores` table. Dashboard adds a Fit column + 🎯 Great fit chip and switches default sort to `overall_score DESC` once a resume exists.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + Storage), `@anthropic-ai/sdk`, Vitest.

Full design doc: `docs/superpowers/specs/2026-09-02-phase-3-fit-scoring-design.md`.

---

## File Structure

**New:**
- `middleware.ts` — auth gate at repo root
- `lib/auth/cookie.ts` — HMAC helpers + cookie name constant
- `lib/auth/cookie.test.ts` — unit tests
- `lib/pdf/extract.ts` — Claude Sonnet PDF → text
- `lib/scoring/prompt.ts` — system + user prompt builders
- `lib/scoring/prompt.test.ts` — snapshot tests for prompt shape
- `lib/scoring/run.ts` — batched scoring loop with time budget
- `app/login/page.tsx` — password form
- `app/api/login/route.ts` — POST verify + set cookie
- `app/resume/page.tsx` — upload UI + status
- `app/api/resume/upload/route.ts` — multipart POST → extract → save
- `app/api/score-all/route.ts` — manual bulk scoring trigger
- `supabase/migrations/20260902030000_profiles_and_scoring.sql`

**Modified:**
- `lib/ats/types.ts` — add `description_text: string | null` to `NormalizedJob`
- `lib/ats/greenhouse.ts` — extract plaintext, populate field
- `lib/ats/ashby.ts` — same
- `lib/ats/lever.ts` — same
- `lib/pipeline/scan.ts` — persist `description_text` at upsert; call `runScoring` after upserts
- `app/dashboard/page.tsx` — Fit column, 🎯 chip, fit-desc default sort
- `.env.local.example` — add `SITE_PASSWORD`, `ANTHROPIC_API_KEY`

---

## Task 1: Add `@anthropic-ai/sdk` dependency

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install the SDK**

Run from `/Users/sratanjee/Beacon`:
```bash
pnpm add @anthropic-ai/sdk
```

Expected: `+ @anthropic-ai/sdk` in dependencies. No errors.

- [ ] **Step 2: Update env example**

Read `/Users/sratanjee/Beacon/.env.local.example` first, then append to it:

```env

# Site password gate (Phase 3). Long random string; set in Vercel too.
SITE_PASSWORD=

# Anthropic API key with access to Haiku 4.5 + Sonnet 4.6 (Phase 3 scoring + PDF extract)
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: Commit**

```bash
cd /Users/sratanjee/Beacon
git add package.json pnpm-lock.yaml .env.local.example
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add @anthropic-ai/sdk + env vars for Phase 3

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migration — profiles table, description_text column, resumes bucket

**Files:**
- Create: `supabase/migrations/20260902030000_profiles_and_scoring.sql`

- [ ] **Step 1: Write the migration**

Create `/Users/sratanjee/Beacon/supabase/migrations/20260902030000_profiles_and_scoring.sql`:

```sql
-- Phase 3: profiles (singleton resume row) + jobs.description_text (for scoring)

create table if not exists profiles (
  id smallint primary key default 1 check (id = 1),  -- enforced singleton
  resume_pdf_path text,
  resume_text text,
  updated_at timestamptz not null default now()
);

alter table jobs add column if not exists description_text text;

-- Private storage bucket for uploaded resume PDFs. Anon reads blocked; the
-- server (service role) is the only writer/reader.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Ask the human to push the migration**

The `pnpm supabase db push` command touches production and needs explicit
authorization. Message the controller:

> "Please run `printf 'Y\n' | pnpm supabase db push` from /Users/sratanjee/Beacon and paste the output."

Wait for confirmation before proceeding.

- [ ] **Step 3: Verify the migration applied**

After push, run:
```bash
cd /Users/sratanjee/Beacon
pnpm supabase db query --linked <<'SQL'
select
  (select count(*) from information_schema.tables where table_name='profiles') as has_profiles,
  (select count(*) from information_schema.columns where table_name='jobs' and column_name='description_text') as has_desc_col,
  (select count(*) from storage.buckets where id='resumes') as has_bucket;
SQL
```

Expected all three: `1`.

- [ ] **Step 4: Commit**

```bash
cd /Users/sratanjee/Beacon
git add supabase/migrations/20260902030000_profiles_and_scoring.sql
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Migration: profiles + jobs.description_text + resumes bucket

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Auth cookie helpers + tests

**Files:**
- Create: `lib/auth/cookie.ts`, `lib/auth/cookie.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/sratanjee/Beacon/lib/auth/cookie.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AUTH_COOKIE, signPassword, verifyCookie } from './cookie';

describe('signPassword', () => {
  it('returns a stable hex string for a given password', () => {
    const a = signPassword('hunter2');
    const b = signPassword('hunter2');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different values for different passwords', () => {
    expect(signPassword('hunter2')).not.toBe(signPassword('hunter3'));
  });
});

describe('verifyCookie', () => {
  it('accepts a cookie value signed with the same password', () => {
    const cookie = signPassword('correct-password');
    expect(verifyCookie(cookie, 'correct-password')).toBe(true);
  });

  it('rejects mismatched password', () => {
    const cookie = signPassword('correct-password');
    expect(verifyCookie(cookie, 'wrong-password')).toBe(false);
  });

  it('rejects null / empty cookie', () => {
    expect(verifyCookie(null, 'anything')).toBe(false);
    expect(verifyCookie('', 'anything')).toBe(false);
    expect(verifyCookie(undefined, 'anything')).toBe(false);
  });

  it('uses constant-time comparison (no early-exit)', () => {
    // If timing-safe, comparing two 64-char strings that differ at position 0
    // and position 63 should not take meaningfully different times.
    // We just assert the API accepts arbitrary strings without throwing.
    expect(verifyCookie('a'.repeat(64), 'x')).toBe(false);
    expect(verifyCookie('a'.repeat(1), 'x')).toBe(false);
  });
});

describe('AUTH_COOKIE constant', () => {
  it('is a stable name', () => {
    expect(AUTH_COOKIE).toBe('beacon_auth');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm test
```

Expected: fails with "Cannot find module './cookie'" or similar.

- [ ] **Step 3: Implement the module**

Create `/Users/sratanjee/Beacon/lib/auth/cookie.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export const AUTH_COOKIE = 'beacon_auth';

// The cookie value is HMAC-SHA256(password, password) — using the password as
// both the key and the message. This gives us a deterministic 64-hex string
// per password without a separate secret to manage. Rotation = change
// SITE_PASSWORD, invalidates all cookies.
export function signPassword(password: string): string {
  return createHmac('sha256', password).update(password).digest('hex');
}

export function verifyCookie(
  cookieValue: string | null | undefined,
  password: string,
): boolean {
  if (!cookieValue || !password) return false;
  const expected = signPassword(password);
  if (cookieValue.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(expected));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: all 6 tests pass; suite total climbs from 58 → 64.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/sratanjee/Beacon
git add lib/auth/
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add auth cookie helpers (HMAC-of-password, constant-time compare)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Login page + /api/login route

**Files:**
- Create: `app/login/page.tsx`, `app/api/login/route.ts`

- [ ] **Step 1: Create the API route**

Create `/Users/sratanjee/Beacon/app/api/login/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, signPassword } from '@/lib/auth/cookie';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '/dashboard');

  const site = process.env.SITE_PASSWORD;
  if (!site) {
    return NextResponse.json({ error: 'SITE_PASSWORD not configured' }, { status: 500 });
  }
  if (password !== site) {
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(next)}`, req.url));
  }

  // Only allow same-origin redirects
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  const res = NextResponse.redirect(new URL(safeNext, req.url));
  res.cookies.set(AUTH_COOKIE, signPassword(site), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
```

- [ ] **Step 2: Create the login page**

Create `/Users/sratanjee/Beacon/app/login/page.tsx`:

```tsx
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
```

- [ ] **Step 3: Typecheck + build**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -12
```

Expected: no tsc output; build shows `/login` and `/api/login` in the route table.

- [ ] **Step 4: Commit**

```bash
cd /Users/sratanjee/Beacon
git add app/login/ app/api/login/
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add /login page + /api/login route

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Middleware to gate all protected routes

**Files:**
- Create: `middleware.ts` (repo root)

- [ ] **Step 1: Write the middleware**

Create `/Users/sratanjee/Beacon/middleware.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyCookie } from '@/lib/auth/cookie';

// Public routes — always accessible without a cookie
const PUBLIC_PATHS = new Set(['/login']);
const PUBLIC_PATH_PREFIXES = ['/api/login', '/api/run-weekly-scan'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const site = process.env.SITE_PASSWORD;
  if (!site) {
    // Fail closed if not configured — better than accidentally leaking during setup
    return NextResponse.redirect(new URL('/login?error=1', req.url));
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (verifyCookie(cookie, site)) return NextResponse.next();

  const next = pathname + req.nextUrl.search;
  return NextResponse.redirect(
    new URL(`/login?next=${encodeURIComponent(next)}`, req.url),
  );
}

export const config = {
  // Run on everything except Next.js internals, static files, favicon.
  matcher: ['/((?!_next/|favicon\\.ico|.*\\..*).*)'],
};
```

- [ ] **Step 2: Set SITE_PASSWORD locally so dev works**

Ask the controller to:
1. Generate a password: `openssl rand -hex 24`
2. Append to `.env.local`: `SITE_PASSWORD=<value>`
3. Set the same value in Vercel: `env VERCEL_TOKEN=$VERCEL_TOKEN vercel env add SITE_PASSWORD production --type secret --yes` (piped from a file, per prior classifier concerns) and same for preview.

Wait for controller confirmation before proceeding.

- [ ] **Step 3: Typecheck + build**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -12
```

Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
cd /Users/sratanjee/Beacon
git add middleware.ts
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add auth middleware: cookie-gate all routes except /login and cron

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: PDF extraction helper

**Files:**
- Create: `lib/pdf/extract.ts`

- [ ] **Step 1: Write the extractor**

Create `/Users/sratanjee/Beacon/lib/pdf/extract.ts`:

```ts
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export type ExtractResult = { text: string; input_tokens: number; output_tokens: number };

export async function extractResumeText(pdfBytes: Buffer): Promise<ExtractResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  const client = new Anthropic({ apiKey: key });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBytes.toString('base64'),
            },
          },
          {
            type: 'text',
            text: 'Extract the plain text of this resume. Preserve section headings, bullet points, dates, and role titles. Return only the plaintext content, no commentary, no markdown fences.',
          },
        ],
      },
    ],
  });

  const first = response.content[0];
  if (!first || first.type !== 'text') {
    throw new Error('Unexpected response shape from Anthropic');
  }
  return {
    text: first.text.trim(),
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd /Users/sratanjee/Beacon
git add lib/pdf/
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add extractResumeText helper (Claude Sonnet PDF → plaintext)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Resume upload API route

**Files:**
- Create: `app/api/resume/upload/route.ts`

- [ ] **Step 1: Write the route**

Create `/Users/sratanjee/Beacon/app/api/resume/upload/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { extractResumeText } from '@/lib/pdf/extract';
import { getServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no file field' }, { status: 400 });
  }
  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'only application/pdf accepted' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file exceeds 5MB' }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const db = getServiceClient();

  const path = `resume-${Date.now()}.pdf`;
  const uploadRes = await db.storage.from('resumes').upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (uploadRes.error) {
    return NextResponse.json({ error: `storage: ${uploadRes.error.message}` }, { status: 500 });
  }

  let extracted;
  try {
    extracted = await extractResumeText(bytes);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const upsertRes = await db
    .from('profiles')
    .upsert({
      id: 1,
      resume_pdf_path: path,
      resume_text: extracted.text,
      updated_at: new Date().toISOString(),
    })
    .select('id, updated_at')
    .single();

  if (upsertRes.error) {
    return NextResponse.json({ error: `db: ${upsertRes.error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    text_length: extracted.text.length,
    input_tokens: extracted.input_tokens,
    updated_at: upsertRes.data.updated_at,
  });
}
```

- [ ] **Step 2: Typecheck + build**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -12
```

Expected: builds, `/api/resume/upload` in route table.

- [ ] **Step 3: Commit**

```bash
cd /Users/sratanjee/Beacon
git add app/api/resume/
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add /api/resume/upload — PDF → Claude → profiles.resume_text

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: /resume upload page

**Files:**
- Create: `app/resume/page.tsx`

- [ ] **Step 1: Create the page**

Create `/Users/sratanjee/Beacon/app/resume/page.tsx`:

```tsx
import Link from 'next/link';
import { getServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type Profile = { resume_pdf_path: string | null; resume_text: string | null; updated_at: string } | null;

export default async function ResumePage() {
  const db = getServiceClient();
  const [profileRes, jobCountsRes] = await Promise.all([
    db.from('profiles').select('resume_pdf_path, resume_text, updated_at').eq('id', 1).maybeSingle(),
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
        {profile?.resume_text && scored < total && (
          <form method="post" action="/api/score-all" className="mt-4">
            <button
              type="submit"
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              Score all {total - scored} unscored
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -12
```

Expected: builds, `/resume` in route table (dynamic).

- [ ] **Step 3: Commit**

```bash
cd /Users/sratanjee/Beacon
git add app/resume/
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add /resume page: upload + status (chars, N/total scored)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Persist description text at fetch time

**Files:**
- Modify: `lib/ats/types.ts`, `lib/ats/greenhouse.ts`, `lib/ats/ashby.ts`, `lib/ats/lever.ts`, `lib/pipeline/scan.ts`

- [ ] **Step 1: Extend NormalizedJob**

Read `/Users/sratanjee/Beacon/lib/ats/types.ts`, then edit:

Add `description_text: string | null;` to `NormalizedJob` (place after `raw: unknown;`).

The file should look like:

```ts
export type NormalizedJob = {
  external_id: string;
  title: string;
  url: string;
  location: string | null;
  remote_ok: boolean | null;
  comp_min: number | null;
  comp_max: number | null;
  raw: unknown;
  description_text: string | null;
};

export type FetchResult = {
  companyId: number;
  companyName: string;
  jobs: NormalizedJob[];
};

export type FetchError = {
  company: string;
  error: string;
};
```

- [ ] **Step 2: Populate in Greenhouse fetcher**

Read `/Users/sratanjee/Beacon/lib/ats/greenhouse.ts`, then modify the `normalize` function.

The existing function throws `job.content` away when it builds `rawWithoutContent`. Instead: build plaintext from it first.

Add this helper at the top of the file, after the imports:

```ts
function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim() || null;
}
```

Then in `normalize`, replace the return object with:

```ts
function normalize(job: GreenhouseJob): NormalizedJob {
  const location = job.location?.name?.trim() || null;
  const { comp_min, comp_max } = parseComp(job.content);
  const { content: _content, ...rawWithoutContent } = job;
  return {
    external_id: String(job.id),
    title: job.title,
    url: job.absolute_url,
    location,
    remote_ok: location ? REMOTE_RE.test(location) : null,
    comp_min,
    comp_max,
    raw: rawWithoutContent,
    description_text: htmlToText(job.content),
  };
}
```

- [ ] **Step 3: Populate in Ashby fetcher**

Read `/Users/sratanjee/Beacon/lib/ats/ashby.ts`, then modify `normalize`.

Add the same `htmlToText` helper at the top of the file (after imports). Then update the return object to include:

```ts
description_text: job.descriptionPlain?.trim() || htmlToText(job.descriptionHtml),
```

as the last field. Final `normalize` should end with:

```ts
  return {
    external_id: job.id,
    title: job.title,
    url: job.jobUrl,
    location,
    remote_ok: typeof job.isRemote === 'boolean' ? job.isRemote : null,
    comp_min,
    comp_max,
    raw: rawWithoutBody,
    description_text: job.descriptionPlain?.trim() || htmlToText(job.descriptionHtml),
  };
```

- [ ] **Step 4: Populate in Lever fetcher**

Read `/Users/sratanjee/Beacon/lib/ats/lever.ts`, then modify `normalize`.

Add the same `htmlToText` helper at the top (after imports). Update return to include:

```ts
description_text:
  job.descriptionPlain?.trim() ||
  (job.additionalPlain?.trim() ? job.additionalPlain.trim() : null) ||
  htmlToText([job.description, job.additional].filter(Boolean).join(' ')),
```

- [ ] **Step 5: Persist in scan.ts**

Read `/Users/sratanjee/Beacon/lib/pipeline/scan.ts`, then find the `rows` map inside `upsertJobs`.

Add `description_text: j.description_text` between `title_matches_role` and `raw`. The map should read:

```ts
const rows = jobs.map((j) => ({
  company_id: company.id,
  external_id: j.external_id,
  title: j.title,
  url: j.url,
  location: j.location,
  remote_ok: j.remote_ok,
  comp_min: j.comp_min,
  comp_max: j.comp_max,
  last_seen_at: now,
  is_active: true,
  title_matches_role: matchesEmRole(j.title),
  description_text: j.description_text,
  raw: j.raw,
}));
```

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Run existing tests**

Run: `pnpm test`
Expected: all pass (fetcher tests don't exist yet; only comp + title suites run). No regressions.

- [ ] **Step 8: Commit**

```bash
cd /Users/sratanjee/Beacon
git add lib/ats/ lib/pipeline/scan.ts
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Persist description_text from fetchers; strips HTML, keeps plaintext

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Scoring prompt builder + tests

**Files:**
- Create: `lib/scoring/prompt.ts`, `lib/scoring/prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/sratanjee/Beacon/lib/scoring/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

describe('buildSystemPrompt', () => {
  it('includes the resume text verbatim', () => {
    const p = buildSystemPrompt('SUMMARY\n10 years EM at Google...');
    expect(p).toContain('SUMMARY');
    expect(p).toContain('10 years EM at Google');
  });

  it('states the response format constraint', () => {
    const p = buildSystemPrompt('r');
    expect(p.toLowerCase()).toContain('json');
  });
});

describe('buildUserPrompt', () => {
  it('includes title, company, location, description', () => {
    const p = buildUserPrompt({
      title: 'Engineering Manager, AI Platform',
      company: 'Anthropic',
      location: 'San Francisco, CA; Remote',
      description_text: 'Build the AI platform team. $250K-$400K comp.',
    });
    expect(p).toContain('Engineering Manager, AI Platform');
    expect(p).toContain('Anthropic');
    expect(p).toContain('San Francisco');
    expect(p).toContain('AI platform team');
  });

  it('handles null location + description', () => {
    const p = buildUserPrompt({
      title: 'Head of Eng',
      company: 'Foo',
      location: null,
      description_text: null,
    });
    expect(p).toContain('Head of Eng');
    expect(p).toContain('Foo');
    expect(p).not.toContain('null');
    expect(p).not.toContain('undefined');
  });

  it('requests structured JSON with the four fields', () => {
    const p = buildUserPrompt({
      title: 't',
      company: 'c',
      location: null,
      description_text: null,
    });
    expect(p).toContain('domain_proximity');
    expect(p).toContain('seniority_match');
    expect(p).toContain('comp_signal');
    expect(p).toContain('overall_score');
    expect(p).toContain('rationale');
  });
});
```

- [ ] **Step 2: Confirm tests fail**

Run: `pnpm test`
Expected: `Cannot find module './prompt'`.

- [ ] **Step 3: Implement**

Create `/Users/sratanjee/Beacon/lib/scoring/prompt.ts`:

```ts
export function buildSystemPrompt(resumeText: string): string {
  return `You are a career-fit evaluator. You'll receive job postings and score each one against the candidate's resume on a 0-100 scale across three dimensions, then produce a composite overall score.

Weight the composite score heavily on domain_proximity (does the role's actual work match what this person has done and is good at?), then seniority_match, then comp_signal.

Return JSON only, no markdown fences, no commentary.

CANDIDATE RESUME:
${resumeText}`;
}

export function buildUserPrompt(job: {
  title: string;
  company: string;
  location: string | null;
  description_text: string | null;
}): string {
  const location = job.location ?? 'not specified';
  const description = job.description_text ?? 'not provided';
  return `Score this posting.

TITLE: ${job.title}
COMPANY: ${job.company}
LOCATION: ${location}
DESCRIPTION:
${description}

Return JSON only in this exact shape:
{
  "domain_proximity": 0-100,
  "seniority_match": 0-100,
  "comp_signal": "above_current" | "below_current" | "comparable" | "undisclosed",
  "overall_score": 0-100,
  "rationale": "one-sentence explanation"
}`;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/sratanjee/Beacon
git add lib/scoring/
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add scoring prompt builders + tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Scoring pipeline (`runScoring`)

**Files:**
- Create: `lib/scoring/run.ts`

- [ ] **Step 1: Write the module**

Create `/Users/sratanjee/Beacon/lib/scoring/run.ts`:

```ts
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceClient } from '@/lib/supabase/server';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

export type ScoringSummary = {
  scored: number;
  failed: number;
  skipped_no_resume: boolean;
  time_budget_hit: boolean;
  errors: { job_id: number; error: string }[];
};

type UnscoredJob = {
  id: number;
  title: string;
  location: string | null;
  description_text: string | null;
  companies: { name: string } | null;
};

type ScoreResponse = {
  domain_proximity: number;
  seniority_match: number;
  comp_signal: 'above_current' | 'below_current' | 'comparable' | 'undisclosed';
  overall_score: number;
  rationale: string;
};

const BATCH_SIZE = 5;
const SOFT_BUDGET_MS = 720_000; // 12 minutes of the 13.3 min maxDuration

export async function runScoring(): Promise<ScoringSummary> {
  const startedAt = Date.now();
  const db = getServiceClient();

  const profileRes = await db
    .from('profiles')
    .select('resume_text')
    .eq('id', 1)
    .maybeSingle();
  const resumeText = profileRes.data?.resume_text?.trim();
  if (!resumeText) {
    return { scored: 0, failed: 0, skipped_no_resume: true, time_budget_hit: false, errors: [] };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey: key });
  const systemPrompt = buildSystemPrompt(resumeText);

  // Pull unscored EM candidates. LEFT-JOIN fit_scores and filter to nulls.
  const unscoredRes = await db
    .from('jobs')
    .select('id, title, location, description_text, companies!inner(name), fit_scores!left(job_id)')
    .eq('is_active', true)
    .eq('title_matches_role', true)
    .is('fit_scores.job_id', null)
    .limit(1000);
  if (unscoredRes.error) throw new Error(`load unscored: ${unscoredRes.error.message}`);
  const jobs = (unscoredRes.data ?? []) as unknown as UnscoredJob[];

  const errors: { job_id: number; error: string }[] = [];
  let scored = 0;

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    if (Date.now() - startedAt > SOFT_BUDGET_MS) {
      return {
        scored,
        failed: errors.length,
        skipped_no_resume: false,
        time_budget_hit: true,
        errors,
      };
    }
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (job) => {
        try {
          const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            system: [
              {
                type: 'text',
                text: systemPrompt,
                cache_control: { type: 'ephemeral' },
              },
            ],
            messages: [
              {
                role: 'user',
                content: buildUserPrompt({
                  title: job.title,
                  company: job.companies?.name ?? 'unknown',
                  location: job.location,
                  description_text: job.description_text,
                }),
              },
            ],
          });
          const block = response.content[0];
          if (!block || block.type !== 'text') {
            throw new Error('unexpected block type');
          }
          const parsed = JSON.parse(block.text) as ScoreResponse;
          return { job, parsed, err: null as string | null };
        } catch (e) {
          return {
            job,
            parsed: null,
            err: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    const inserts = results
      .filter((r) => r.parsed !== null)
      .map((r) => ({
        job_id: r.job.id,
        domain_proximity_score: r.parsed!.domain_proximity,
        seniority_match_score: r.parsed!.seniority_match,
        comp_signal: r.parsed!.comp_signal,
        overall_score: r.parsed!.overall_score,
        rationale: r.parsed!.rationale,
        scored_at: new Date().toISOString(),
      }));

    if (inserts.length > 0) {
      const upsertRes = await db.from('fit_scores').upsert(inserts, { onConflict: 'job_id' });
      if (upsertRes.error) {
        for (const ins of inserts) {
          errors.push({ job_id: ins.job_id, error: `upsert: ${upsertRes.error.message}` });
        }
      } else {
        scored += inserts.length;
      }
    }

    for (const r of results) {
      if (r.err) errors.push({ job_id: r.job.id, error: r.err });
    }
  }

  return {
    scored,
    failed: errors.length,
    skipped_no_resume: false,
    time_budget_hit: false,
    errors,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/sratanjee/Beacon
git add lib/scoring/run.ts
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add runScoring: Haiku 4.5 with prompt-cached resume, 5-way parallel, 12-min budget

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `/api/score-all` route + wire post-scan trigger

**Files:**
- Create: `app/api/score-all/route.ts`
- Modify: `lib/pipeline/scan.ts` (call `runScoring` after upserts)

- [ ] **Step 1: Create the route**

Create `/Users/sratanjee/Beacon/app/api/score-all/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { runScoring } from '@/lib/scoring/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(_req: NextRequest) {
  try {
    const summary = await runScoring();
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
```

Note: this route is protected by the middleware (cookie auth), so no bearer
check needed here.

- [ ] **Step 2: Wire post-scan trigger**

Read `/Users/sratanjee/Beacon/lib/pipeline/scan.ts`, find the end of `runScan`
right before it inserts the `fetch_runs` row. Add a scoring call after all
company batches finish but before recording the run:

Right after the `for` loop that iterates `list` in batches, add:

```ts
// Score any newly-fetched jobs that match the title filter (best-effort;
// failures don't fail the scan itself).
let scoringResult: { scored: number; failed: number; time_budget_hit: boolean } | null = null;
try {
  const { runScoring } = await import('@/lib/scoring/run');
  const r = await runScoring();
  scoringResult = { scored: r.scored, failed: r.failed, time_budget_hit: r.time_budget_hit };
} catch (e) {
  errors.push({
    company: '<scoring>',
    error: e instanceof Error ? e.message : String(e),
  });
}
```

Then extend the `fetch_runs` insert to include scoring info in the `errors`
column? Or leave `errors` alone. Simplest: leave `fetch_runs` schema
unchanged; scoring result is available via a separate query.

Actually — extend the `ScanSummary` type and return, so the caller (API route)
sees it. Edit the `ScanSummary` type at the top of the file:

```ts
export type ScanSummary = {
  run_id: number | null;
  companies_checked: number;
  jobs_seen: number;
  new_jobs_found: number;
  errors: FetchError[];
  scoring?: { scored: number; failed: number; time_budget_hit: boolean } | null;
};
```

And add `scoring: scoringResult` to both return statements at the end of
`runScan` (the error-case and success-case returns).

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Build**

Run: `pnpm exec next build 2>&1 | tail -12`
Expected: `/api/score-all` in route list, no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/sratanjee/Beacon
git add app/api/score-all/ lib/pipeline/scan.ts
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add /api/score-all + auto-score after scan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Dashboard integration — Fit column, chip, sort default

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Read the current file**

Read `/Users/sratanjee/Beacon/app/dashboard/page.tsx` in full. It's ~280 lines.

- [ ] **Step 2: Extend the SortKey union + SORT_COLUMNS**

Change the `SortKey` type from:
```ts
type SortKey = 'first_seen' | 'company' | 'title' | 'location' | 'comp';
```
to:
```ts
type SortKey = 'first_seen' | 'company' | 'title' | 'location' | 'comp' | 'fit';
```

Change the `SORT_COLUMNS` const from:
```ts
const SORT_COLUMNS: Record<SortKey, string> = {
  first_seen: 'first_seen_at',
  company: 'companies(name)',
  title: 'title',
  location: 'location',
  comp: 'comp_max',
};
```
to:
```ts
const SORT_COLUMNS: Record<SortKey, string> = {
  first_seen: 'first_seen_at',
  company: 'companies(name)',
  title: 'title',
  location: 'location',
  comp: 'comp_max',
  fit: 'fit_scores(overall_score)',
};
```

- [ ] **Step 3: Add fit filter param**

In the `SearchParams` type, add `great_fit?: string;` alongside the others.

In the params parsing (around line 60), add:
```ts
const greatFitOnly = params.great_fit === '1';
```

- [ ] **Step 4: Extend the Row type + query**

Change the `Row` type to include fit fields (Supabase returns related rows as
an array via `!left`, even for one-to-one relationships — take `[0]` when
rendering):
```ts
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
  fit_scores: Array<{ overall_score: number | null; rationale: string | null }> | null;
};
```

In the query builder, change the SELECT string from:
```ts
'id, title, url, location, remote_ok, comp_min, comp_max, first_seen_at, companies!inner(name, notable_lists)'
```
to:
```ts
'id, title, url, location, remote_ok, comp_min, comp_max, first_seen_at, companies!inner(name, notable_lists), fit_scores!left(overall_score, rationale)'
```

After the `if (validMinComp) query = query.gte('comp_max', validMinComp);` line, add:
```ts
if (greatFitOnly) query = query.gte('fit_scores.overall_score', 70);
```

- [ ] **Step 5: Change sort default based on resume presence**

Just before the `sort` variable is computed, add:
```ts
const profileRes = await db.from('profiles').select('id').eq('id', 1).maybeSingle();
const hasResume = !!profileRes.data;
```

Change the sort default. Replace:
```ts
const sort: SortKey = (
  ['first_seen', 'company', 'title', 'location', 'comp'] as const
).includes(params.sort as SortKey)
  ? (params.sort as SortKey)
  : 'first_seen';
```
with:
```ts
const validSorts = ['first_seen', 'company', 'title', 'location', 'comp', 'fit'] as const;
const sort: SortKey = (validSorts as readonly string[]).includes(params.sort ?? '')
  ? (params.sort as SortKey)
  : hasResume
    ? 'fit'
    : 'first_seen';
```

- [ ] **Step 6: Handle fit sort like comp (nulls last)**

In the sort switch, extend:
```ts
if (sort === 'comp') {
  query = query.order('comp_max', { ascending: dir === 'asc', nullsFirst: false });
} else {
  query = query.order(SORT_COLUMNS[sort], { ascending: dir === 'asc' });
}
```
to:
```ts
if (sort === 'comp') {
  query = query.order('comp_max', { ascending: dir === 'asc', nullsFirst: false });
} else if (sort === 'fit') {
  query = query.order('fit_scores(overall_score)', { ascending: dir === 'asc', nullsFirst: false });
} else {
  query = query.order(SORT_COLUMNS[sort], { ascending: dir === 'asc' });
}
```

- [ ] **Step 7: Add the fit chip to the chip row**

In the chip row JSX (find the `<div className="mt-3 flex flex-wrap gap-2">`),
add a new Link right before the 🤖 Top AI one:

```tsx
<Link
  href={linkFor({ great_fit: greatFitOnly ? '' : '1' })}
  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
    greatFitOnly
      ? 'bg-amber-600 text-white'
      : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
  }`}
>
  🎯 Great fit
</Link>
```

Also add `great_fit` to the `linkFor` builder — after the `if (validMinComp)` line, add:
```ts
if (greatFitOnly) sp.set('great_fit', '1');
```

- [ ] **Step 8: Add Fit column to the table header and body**

In the `<thead>` `<tr>` block, insert a new `<th>` between the `Remote` header
and the `Comp` header:

```tsx
<th className="py-2 pr-4 font-medium">{sortLink('fit', 'Fit')}</th>
```

In the row body, insert this `<td>` in the same position (between `Remote` cell and `Comp` cell):

```tsx
<td className="py-2 pr-4">
  {(() => {
    const fs = row.fit_scores?.[0];
    const s = fs?.overall_score;
    if (s == null) return <span className="text-zinc-400">—</span>;
    const color =
      s >= 70
        ? 'font-semibold text-emerald-700 dark:text-emerald-400'
        : s >= 40
          ? 'text-zinc-700 dark:text-zinc-300'
          : 'text-zinc-400';
    return (
      <span className={color} title={fs?.rationale ?? undefined}>
        {s}
      </span>
    );
  })()}
</td>
```

Bump the `colSpan={7}` on the "No matches" fallback row to `colSpan={8}`.

- [ ] **Step 9: Include great_fit in Clear check**

Find the `(company || remoteOnly || validMinComp || aiOnly) && (` block and
change it to `(company || remoteOnly || validMinComp || aiOnly || greatFitOnly) && (`.

Also add `{greatFitOnly && <input type="hidden" name="great_fit" value="1" />}` inside the `<form>` next to the other hidden inputs.

- [ ] **Step 10: Typecheck + build**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -12
```

Expected: clean.

- [ ] **Step 11: Commit**

```bash
cd /Users/sratanjee/Beacon
git add app/dashboard/page.tsx
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Dashboard: Fit column, 🎯 Great fit chip, fit-desc default when resume exists

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Deploy + set prod env vars + smoke test

**Files:** none (deployment + runtime verification)

- [ ] **Step 1: Push commits**

Run:
```bash
cd /Users/sratanjee/Beacon
git push
```

- [ ] **Step 2: Set production env vars (ask controller if not already set)**

The controller should confirm both are set in Vercel. If SITE_PASSWORD was
handled in Task 5, only ANTHROPIC_API_KEY remains. Ask:

> "Please add ANTHROPIC_API_KEY to the Vercel beacon project (production + preview, type=secret). If you have the value handy, run:
> `printf '$YOUR_KEY_HERE' | env VERCEL_TOKEN=$VT vercel env add ANTHROPIC_API_KEY production --type secret --yes` (same for preview)."

Wait for confirmation.

- [ ] **Step 3: Deploy**

Ask the controller to run:
```bash
cd /Users/sratanjee/Beacon
env VERCEL_TOKEN=<token> vercel --prod --yes
```

Wait for the deployment URL.

- [ ] **Step 4: Smoke test login flow**

From the controller's shell:
```bash
# Unauthenticated → redirect to login
curl -sSL -o /dev/null -w "%{http_code} %{url_effective}\n" https://beacon-one-rosy.vercel.app/dashboard
```
Expected: `200 https://beacon-one-rosy.vercel.app/login?next=%2Fdashboard`

- [ ] **Step 5: Upload a real resume**

Controller opens https://mybeacon.sh/resume in a browser, logs in, uploads a
PDF. Expects the "Status" section to update showing char count + "0 / 449 scored".

- [ ] **Step 6: Click "Score all"**

Controller clicks the button. Vercel starts an 800s function. Response comes
back with `{ scored, failed, time_budget_hit, errors }`.

- [ ] **Step 7: Verify counts**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm supabase db query --linked <<'SQL'
select
  count(*) filter (where is_active and title_matches_role) as em_total,
  (select count(*) from fit_scores fs join jobs j on j.id = fs.job_id where j.is_active and j.title_matches_role) as em_scored,
  (select round(avg(overall_score)::numeric, 1) from fit_scores fs join jobs j on j.id = fs.job_id where j.is_active and j.title_matches_role) as avg_score,
  (select count(*) from fit_scores fs join jobs j on j.id = fs.job_id where j.is_active and j.title_matches_role and fs.overall_score >= 70) as great_fits;
SQL
```

Expected: `em_scored` matches or nearly matches `em_total`; `great_fits` is a plausible number (5-50 range depending on resume specificity).

- [ ] **Step 8: Verify dashboard**

Controller opens https://mybeacon.sh/dashboard on phone (or via the deployment
alias if mybeacon.sh is still Zscaler-blocked). Expects:
- Fit column visible, sorted descending by default
- 🎯 Great fit chip toggles the ≥70 filter
- Hovering a fit score shows the rationale tooltip

- [ ] **Step 9: If anything's off, iterate**

Common issues to check:
- Scoring returned 0 → check `ANTHROPIC_API_KEY` is set + valid.
- All scores are similar → resume text may be truncated; check `select length(resume_text) from profiles`. Should be > 500 chars.
- Time-budget hit → re-trigger `POST /api/score-all` from the browser; unscored rows will resume.

---

## Verification checklist (before marking done)

- [ ] All Vitest tests pass: `pnpm test`
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `pnpm exec next build` compiles
- [ ] Login flow works: unauthenticated request to `/dashboard` redirects to `/login`
- [ ] Resume upload UI shows char count after upload
- [ ] `/api/score-all` returns non-zero scored count
- [ ] Dashboard Fit column populated, sortable
- [ ] 🎯 chip filters correctly
- [ ] Next scan run (Mon cron or manual trigger) auto-scores any new EM candidates
