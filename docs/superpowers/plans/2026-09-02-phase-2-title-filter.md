# Phase 2 Title Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `title_matches_role` boolean to `jobs` computed by a regex filter in TypeScript, so Phase 3 (Claude scoring) can query the ~300-500 EM-adjacent candidates cheaply instead of paying tokens on all 14,962 raw postings.

**Architecture:** Pure function `matchesEmRole(title)` in `lib/filter/title.ts`, unit-tested with Vitest against ≥20 real titles pulled from the current DB. `scan.ts` computes the flag at upsert time. Migration adds the column with default `false` and a partial index; the next scan run backfills correct values (no separate SQL regex needed — TS stays source of truth). Design doc: `docs/superpowers/specs/2026-09-02-phase-2-title-filter-design.md`.

**Tech Stack:** TypeScript, Vitest, Supabase (Postgres 17), Next.js 16 App Router

---

## File Structure

- Create: `lib/filter/title.ts` — pure `matchesEmRole(title: string): boolean` + regex literals
- Create: `lib/filter/title.test.ts` — Vitest tests, ≥ 20 real-title cases
- Create: `vitest.config.ts` — Vitest config (Next 16 doesn't ship Vitest)
- Modify: `package.json` — add Vitest devDep + `test` npm script
- Create: `supabase/migrations/20260902010000_title_matches_role.sql` — column + partial index
- Modify: `lib/pipeline/scan.ts` — compute `title_matches_role` in the upsert row

---

## Task 1: Add Vitest with a smoke test

**Files:**
- Modify: `package.json` (add devDep + script)
- Create: `vitest.config.ts`
- Create: `lib/filter/smoke.test.ts` (deleted at end of task once real tests exist)

- [ ] **Step 1: Install Vitest**

Run: `pnpm add -D vitest@^2 @vitest/coverage-v8@^2`
Expected: two devDeps added, no errors.

- [ ] **Step 2: Create Vitest config**

Create `/Users/sratanjee/Beacon/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Add `test` script to package.json**

Edit `/Users/sratanjee/Beacon/package.json` — change the `"scripts"` block to add a `"test"` entry:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run"
}
```

- [ ] **Step 4: Write a trivial smoke test to prove Vitest is wired**

Create `/Users/sratanjee/Beacon/lib/filter/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run: `pnpm test`
Expected: `1 passed`, exit code 0.

- [ ] **Step 6: Delete the smoke test**

Run: `rm /Users/sratanjee/Beacon/lib/filter/smoke.test.ts`

- [ ] **Step 7: Commit**

```bash
cd /Users/sratanjee/Beacon
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "Add Vitest for unit tests"
```

---

## Task 2: Write failing tests for `matchesEmRole`

**Files:**
- Create: `lib/filter/title.test.ts`

- [ ] **Step 1: Create the test file with real titles from the DB**

Create `/Users/sratanjee/Beacon/lib/filter/title.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesEmRole } from './title';

// Titles pulled from the live DB on 2026-09-02 via
// `select distinct title from jobs where is_active and title ~* '(manager|head|director|vp)' limit 100`
// Split into what we WANT to surface for Sarang's EM search vs what we don't.
const INCLUDES = [
  'Engineering Manager',
  'Engineering Manager, Consumer Product',
  'Senior Software Engineering Manager, Simulation Platforms',
  'Machine Learning Engineering Manager',
  'Director of Engineering',
  'Director of Engineering, AI Platform',
  'Director of Engineering, Rocket Motor Systems',
  'Director of Security Engineering',
  'Director, Engineering, Enterprise',
  'Director, Engineering - Cloud Observability',
  'Head of Engineering',
  'Head of Applied AI',
  'VP, Engineering',
  'VP of Engineering',
  'Manager, Platform Engineering',
  'Manager, Software Engineering',
  'Senior EM, Growth',
];

const EXCLUDES = [
  'Manufacturing Engineering Manager, Roadrunner',
  'Test Engineering Manager',
  'Quality Engineering Manager',
  'Director, Enterprise Sales Engineering - US Central',
  'Director, Field Engineering (CPG & Retail)',
  'Director of Recruiting, Engineering & IT, Bangalore India',
  'Director of Supplier Industrialization Engineering',
  'Director, People Partners - Product, Design & Engineering',
  'Director, Legal Engineering, EMEA',
  'Director, Manufacturing Engineering',
  'Senior EMC Design Engineer, Air Dominance and Strike',
  'Product Manager, Growth',
  'Marketing Manager',
  'Account Executive - GTM Overlay',
  'Compounding Pharmacy Technician',
];

describe('matchesEmRole', () => {
  it('returns false for empty', () => {
    expect(matchesEmRole('')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(matchesEmRole(null as unknown as string)).toBe(false);
    expect(matchesEmRole(undefined as unknown as string)).toBe(false);
  });

  for (const title of INCLUDES) {
    it(`includes: ${title}`, () => {
      expect(matchesEmRole(title)).toBe(true);
    });
  }

  for (const title of EXCLUDES) {
    it(`excludes: ${title}`, () => {
      expect(matchesEmRole(title)).toBe(false);
    });
  }
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test`
Expected: **fails with `Cannot find module './title'`** or similar module-not-found. Do NOT proceed past this until the failure is confirmed.

- [ ] **Step 3: Commit the failing tests**

```bash
cd /Users/sratanjee/Beacon
git add lib/filter/title.test.ts
git commit -m "Add failing tests for title filter"
```

---

## Task 3: Implement `matchesEmRole` until tests pass

**Files:**
- Create: `lib/filter/title.ts`

- [ ] **Step 1: Write the initial implementation**

Create `/Users/sratanjee/Beacon/lib/filter/title.ts`:

```ts
// Layer 1 title filter — see docs/superpowers/specs/2026-09-02-phase-2-title-filter-design.md
//
// High recall, tolerable precision: catch every plausible EM/HoE/DoE/VP-Eng
// role in software/product/platform/infra domains. Phase 3 Claude scoring
// handles fine-grained judgment on domain fit and seniority.

const INCLUDE_PATTERNS: RegExp[] = [
  /engineering manager/i,
  /\bsenior em\b/i,
  // "Head of Engineering", "Head of Applied AI", etc. — bounded window to
  // avoid catching "Head of Recruiting, Engineering & IT"
  /\bhead of .{0,40}?(engineering|applied ai|applied ml|platform|infrastructure|data|ml|ai)\b/i,
  // "Director of Engineering", "Director of X Engineering", "Director, Engineering"
  /\bdirector[,\s]+(?:of\s+)?[a-z &\-—,]{0,40}engineering\b/i,
  // "VP, Engineering", "VP of Engineering"
  /\bvp[,\s]+(?:of\s+)?[a-z &\-—,]{0,20}engineering\b/i,
  // "Manager, Platform Engineering" (comma-flipped)
  /\bmanager,\s*[a-z &\-—]{0,30}engineering\b/i,
];

const EXCLUDE_PATTERNS: RegExp[] = [
  /\bsales engineer/i,
  /\bfield engineering/i,
  /\benterprise sales/i,
  /\bproduct manager\b/i,           // spec §5
  /\bmarketing\b/i,                 // spec §5
  /\bmanufacturing/i,               // Anduril
  /\btest engineering/i,            // Anduril
  /\bquality engineering/i,
  /\bem[ci]\b/i,                    // EMI/EMC test roles
  /\bsystems test\b/i,
  /\bhardware engineering/i,
  /\bmechanical engineering/i,
  /\belectrical engineering/i,
  /\bpharmacy\b/i,
  /\brecruit/i,                     // "Director of Recruiting, Engineering & IT"
  /\bsupplier/i,
  /\bindustrialization/i,
  /\blegal engineering/i,
  /\bpeople partners?/i,
  /\bpayroll/i,
  /\bfinance systems/i,
];

export function matchesEmRole(title: string | null | undefined): boolean {
  if (!title) return false;
  for (const re of EXCLUDE_PATTERNS) if (re.test(title)) return false;
  for (const re of INCLUDE_PATTERNS) if (re.test(title)) return true;
  return false;
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: all `INCLUDES` and `EXCLUDES` pass, empty/null cases pass. If any fail, adjust regex or move title between arrays only if the title is genuinely ambiguous — do not weaken tests to force pass.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
cd /Users/sratanjee/Beacon
git add lib/filter/title.ts
git commit -m "Implement matchesEmRole regex filter"
```

---

## Task 4: Add migration for `title_matches_role` column + partial index

**Files:**
- Create: `supabase/migrations/20260902010000_title_matches_role.sql`

- [ ] **Step 1: Write the migration**

Create `/Users/sratanjee/Beacon/supabase/migrations/20260902010000_title_matches_role.sql`:

```sql
-- Phase 2 title filter — Layer 1
--
-- Adds a boolean flag set by scan.ts at upsert time. Backfill happens on the
-- next scan run (TS regex is source of truth); intermediate window where
-- existing rows have `false` is acceptable because no dashboard reads this yet.

alter table jobs
  add column if not exists title_matches_role boolean not null default false;

-- Partial index over active-and-matching rows — the shape Phase 3's scorer will
-- query: WHERE title_matches_role AND is_active AND fit_scored_at IS NULL
create index if not exists jobs_title_matches_active_idx
  on jobs (title_matches_role, last_seen_at desc)
  where is_active;
```

- [ ] **Step 2: Push the migration to remote**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm supabase db push
```

Answer `Y` if prompted. Expected: `Applying migration 20260902010000_title_matches_role.sql`.

- [ ] **Step 3: Verify the column exists**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm supabase db query --linked <<'SQL'
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'jobs' and column_name = 'title_matches_role';
SQL
```

Expected: one row, `boolean`, default `false`.

- [ ] **Step 4: Commit**

```bash
cd /Users/sratanjee/Beacon
git add supabase/migrations/20260902010000_title_matches_role.sql
git commit -m "Migration: add title_matches_role column + partial index"
```

---

## Task 5: Wire `scan.ts` to compute the flag at upsert time

**Files:**
- Modify: `lib/pipeline/scan.ts`

- [ ] **Step 1: Add the import**

Edit `/Users/sratanjee/Beacon/lib/pipeline/scan.ts`. Add near the top with the other `@/lib/...` imports:

```ts
import { matchesEmRole } from '@/lib/filter/title';
```

- [ ] **Step 2: Add the field to the upsert row**

In `upsertJobs`, the `rows` map currently reads:

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
  raw: j.raw,
}));
```

Replace it with:

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
  raw: j.raw,
}));
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Next build (confirms App Router still compiles)**

Run: `pnpm exec next build 2>&1 | tail -8`
Expected: `Compiled successfully`, `/api/run-weekly-scan` in the route list.

- [ ] **Step 5: Commit**

```bash
cd /Users/sratanjee/Beacon
git add lib/pipeline/scan.ts
git commit -m "scan: compute title_matches_role at upsert"
```

---

## Task 6: Deploy + backfill via scan; verify counts

**Files:**
- (No code changes — runtime verification only)

- [ ] **Step 1: Deploy to production**

Run:
```bash
cd /Users/sratanjee/Beacon
git push
vercel --prod --yes 2>&1 | tail -8
```

The `vercel` CLI needs an auth token. Precedence: `VERCEL_TOKEN` env var, then `~/Library/Application Support/com.vercel.cli/auth.json` (populated by prior `vercel login`). If neither is set, ask the user to either export a token they created at https://vercel.com/account/tokens, or to run `vercel login` themselves via a `!` prefix in the chat so the interactive device flow lands in the session. Expected on success: `Deployment ... ready`.

- [ ] **Step 2: Trigger production scan (this backfills the flag)**

Run:
```bash
cd /Users/sratanjee/Beacon
CRON_SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d= -f2)
curl -sS -X POST -H "authorization: Bearer $CRON_SECRET" --max-time 400 \
  https://beacon-one-rosy.vercel.app/api/run-weekly-scan | python3 -m json.tool
```

Expected: `errors: []`, `companies_checked: 103`, `jobs_seen` around 15,000.

- [ ] **Step 3: Confirm the flag landed on real data**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm supabase db query --linked <<'SQL'
select
  count(*) filter (where title_matches_role and is_active) as matched_active,
  count(*) filter (where is_active) as total_active
from jobs;
SQL
```

Expected: `matched_active` between 300 and 500. If below 200 or above 800, the regex is off — return to Task 3 and iterate.

- [ ] **Step 4: Spot-check 20 matched titles**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm supabase db query --linked <<'SQL'
select c.name, j.title
from jobs j join companies c on c.id = j.company_id
where j.title_matches_role and j.is_active
order by random()
limit 20;
SQL
```

Read the output. If more than 2 of 20 look like clear false positives (e.g. Manufacturing/Test still slipping through), add them to the exclude list, re-run tests, redeploy, re-scan.

- [ ] **Step 5: Spot-check 20 rejected titles**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm supabase db query --linked <<'SQL'
select c.name, j.title
from jobs j join companies c on c.id = j.company_id
where not j.title_matches_role and j.is_active
  and j.title ~* '(engineering|technical|platform)'
  and j.title ~* '(manager|director|head|vp|lead)'
order by random()
limit 20;
SQL
```

Read the output. If more than 2 of 20 look like clear false negatives (a real EM slipped past), add the pattern to the include list, iterate.

- [ ] **Step 6: Commit any regex iterations**

If Steps 4 or 5 required edits, commit them:
```bash
cd /Users/sratanjee/Beacon
git add lib/filter/title.ts lib/filter/title.test.ts
git commit -m "Refine title filter based on production spot-check"
git push
vercel --prod --yes
```

Then re-run Steps 2-5 until the false-positive and false-negative rates are both ≤ 10% (≤ 2 of 20).

---

## Verification checklist (before marking done)

- [ ] `pnpm test` passes with all include/exclude cases + empty/null.
- [ ] `pnpm exec tsc --noEmit` is clean.
- [ ] `pnpm exec next build` compiles.
- [ ] Migration applied on remote; `information_schema` shows the column.
- [ ] Production scan run has `errors: []`.
- [ ] `select count(*) from jobs where title_matches_role and is_active` returns 300-500.
- [ ] Spot-check 20 matched + 20 rejected — false rates ≤ 10% each side.
- [ ] Every file change committed and pushed to `main`.
