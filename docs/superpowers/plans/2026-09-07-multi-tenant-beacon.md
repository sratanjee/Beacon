# Multi-Tenant Beacon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open Beacon to 3-10 invited friends via Supabase Auth magic link, with per-user resume/positioning/scores/saved-list/generated-docs and 6 preset role packs, while preserving Sarang's existing data as the first user.

**Architecture:** Supabase Auth for identity (magic link, allowlist-gated). Existing `profiles` table (singleton row) becomes `users` (one row per person, keyed by `auth.users.id` UUID). All per-user tables get a `user_id` FK + composite primary key. New `job_role_matches` precomputes which of 6 role packs each job matches at scan time. Company universe stays shared; scoring runs per-user during weekly scan.

**Tech Stack:** Next.js 16 App Router · Supabase (Postgres + Storage + Auth) · TypeScript · Vitest · Anthropic Claude (Sonnet + Haiku)

Full design: `docs/superpowers/specs/2026-09-07-multi-tenant-beacon-design.md`

---

## File Structure

**New files:**
- `supabase/migrations/20260907010000_multi_tenant.sql` — schema migration
- `supabase/migrations/20260907020000_populate_job_role_matches.sql` — one-time backfill
- `lib/roles/packs.ts` — 6 role-pack definitions (typed constants + regex + `matchesPack`)
- `lib/roles/packs.test.ts` — Vitest suite covering each pack with real titles
- `lib/auth/user.ts` — helpers (`getCurrentUser`, `requireUser`, `requireAdmin`)
- `app/api/auth/request-link/route.ts` — POST email → allowlist check → `supabase.auth.signInWithOtp`
- `app/api/auth/callback/route.ts` — Supabase OAuth callback exchange (magic-link redirect handler)
- `app/onboarding/page.tsx` — 3-step form (role pack → resume PDF → positioning)
- `app/api/onboarding/route.ts` — POST that persists role_pack + redirects
- `app/admin/invites/page.tsx` — admin-only allowlist manager
- `app/api/admin/invites/route.ts` — POST add / DELETE remove
- `app/logout/route.ts` — POST → `supabase.auth.signOut` → redirect to `/login`

**Modified files:**
- `middleware.ts` — replace HMAC cookie check with `supabase.auth.getUser()`
- `app/login/page.tsx` — email-only form, no password
- `app/api/login/route.ts` — replace with redirect to `/api/auth/request-link` (or delete + point form action at new route)
- `app/dashboard/page.tsx` — all queries scoped by `user_id`; add avatar/menu
- `app/jobs/[id]/page.tsx` — per-user fit / states / docs
- `app/jobs/[id]/generate-section.tsx` — no change (route-scoped downstream)
- `app/resume/page.tsx` — writes to `users` row (not `profiles`)
- `app/api/resume/upload/route.ts` — upsert on `users` where `id = auth.uid()`
- `app/api/positioning/route.ts` — upsert on `users` where `id = auth.uid()`
- `app/api/jobs/[id]/generate/route.ts` — read profile from `users` for current user; upsert `generated_docs` with `user_id`
- `app/api/jobs/[id]/download/route.ts` — add `.eq('user_id', currentUserId)` to `generated_docs` query
- `app/api/jobs/[id]/state/route.ts` — upsert `job_states` with `user_id`; composite PK on (job_id, user_id)
- `app/api/rewrite-resume/route.ts` — read profile from `users` for current user
- `app/api/score-all/route.ts` — score for current user only (not global)
- `lib/pipeline/scan.ts` — populate `job_role_matches` at upsert time; loop over all users during auto-scoring
- `lib/scoring/run.ts` — accept `userId` param; scope queries and filter to user's role pack
- `app/api/companies/[id]/summary/route.ts` — no user scoping needed (summary is shared)
- `.env.local.example` — add `NEXT_PUBLIC_SUPABASE_URL` (already present) and note `SITE_PASSWORD` is now optional

**Deleted files (last, after everything migrates):**
- `lib/auth/cookie.ts` + `lib/auth/cookie.test.ts` — HMAC cookie helpers retire
- The `profiles` table (via migration) and the `jobs.title_matches_role` column

---

## Task 1: Schema migration (new tables + column adds)

**Files:**
- Create: `supabase/migrations/20260907010000_multi_tenant.sql`

- [ ] **Step 1: Write the migration**

Create `/Users/sratanjee/Beacon/supabase/migrations/20260907010000_multi_tenant.sql`:

```sql
-- Multi-tenant Beacon: users, invited_emails, job_role_matches.
-- Preserves existing profiles data via a companion migration; this one only
-- adds structure.

create table if not exists users (
  id              uuid primary key,          -- matches auth.users.id
  email           text not null unique,
  display_name    text,
  role            text not null default 'user' check (role in ('user', 'admin')),
  role_pack       text check (role_pack in ('em','sr_ic','pm','designer','data_ml','gtm')),
  positioning     text,
  resume_pdf_path text,
  resume_text     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists invited_emails (
  email       text primary key,
  invited_by  uuid references users(id) on delete set null,
  invited_at  timestamptz not null default now()
);

create table if not exists job_role_matches (
  job_id     bigint not null references jobs(id) on delete cascade,
  role_pack  text   not null check (role_pack in ('em','sr_ic','pm','designer','data_ml','gtm')),
  primary key (job_id, role_pack)
);
create index if not exists job_role_matches_pack_idx on job_role_matches (role_pack, job_id);

-- Add user_id to per-user tables. Nullable initially so migration Task 3
-- can backfill Sarang's uuid; a later migration will flip to NOT NULL.
alter table fit_scores      add column if not exists user_id uuid references users(id) on delete cascade;
alter table generated_docs  add column if not exists user_id uuid references users(id) on delete cascade;
alter table job_states      add column if not exists user_id uuid references users(id) on delete cascade;
```

- [ ] **Step 2: Push migration**

Run:
```bash
cd /Users/sratanjee/Beacon
printf 'Y\n' | pnpm supabase db push
```

Expected: `Applying migration 20260907010000_multi_tenant.sql`. Then verify:

```bash
pnpm supabase db query --linked <<'SQL'
select
  (select count(*) from information_schema.tables where table_name='users') as has_users,
  (select count(*) from information_schema.tables where table_name='invited_emails') as has_invited,
  (select count(*) from information_schema.tables where table_name='job_role_matches') as has_jrm,
  (select count(*) from information_schema.columns where table_name='fit_scores' and column_name='user_id') as fs_uid,
  (select count(*) from information_schema.columns where table_name='generated_docs' and column_name='user_id') as gd_uid,
  (select count(*) from information_schema.columns where table_name='job_states' and column_name='user_id') as js_uid;
SQL
```

Expected: all six values `1`.

- [ ] **Step 3: Commit**

```bash
cd /Users/sratanjee/Beacon
git add supabase/migrations/20260907010000_multi_tenant.sql
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Migration: users + invited_emails + job_role_matches + user_id cols

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Role pack definitions + tests

**Files:**
- Create: `lib/roles/packs.ts`
- Create: `lib/roles/packs.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/sratanjee/Beacon/lib/roles/packs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ROLE_PACKS, matchesPack, packsMatching } from './packs';

describe('ROLE_PACKS metadata', () => {
  it('has the six expected packs', () => {
    const ids = ROLE_PACKS.map((p) => p.id).sort();
    expect(ids).toEqual(['data_ml', 'designer', 'em', 'gtm', 'pm', 'sr_ic']);
  });

  it('every pack has a label and description', () => {
    for (const p of ROLE_PACKS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});

describe('matchesPack — em', () => {
  const positives = [
    'Engineering Manager',
    'Senior Engineering Manager, Platform',
    'Director of Engineering',
    'Head of Engineering',
    'VP, Engineering',
    'Manager, Software Engineering',
  ];
  const negatives = [
    'Software Engineer',
    'Staff Engineer',
    'Product Manager',
    'Sales Manager',
    'Manufacturing Engineering Manager',
    'Technical Program Manager',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('em', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('em', t)).toBe(false));
});

describe('matchesPack — sr_ic', () => {
  const positives = [
    'Staff Software Engineer',
    'Principal Engineer',
    'Senior Staff Engineer, Platform',
    'Distinguished Engineer',
    'Staff Engineer, ML',
  ];
  const negatives = [
    'Software Engineer',
    'Engineering Manager',
    'Sales Engineer',
    'Solutions Engineer',
    'Field Engineer',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('sr_ic', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('sr_ic', t)).toBe(false));
});

describe('matchesPack — pm', () => {
  const positives = [
    'Product Manager',
    'Senior Product Manager, Growth',
    'Group Product Manager',
    'Head of Product',
    'Director of Product',
    'VP Product',
  ];
  const negatives = [
    'Program Manager',
    'Technical Program Manager',
    'Project Manager',
    'Engineering Manager',
    'Marketing Manager',
    'Product Marketing Manager',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('pm', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('pm', t)).toBe(false));
});

describe('matchesPack — designer', () => {
  const positives = [
    'Product Designer',
    'Senior Product Designer',
    'Staff Product Designer',
    'Design Manager',
    'Head of Design',
    'UX Designer',
  ];
  const negatives = [
    'Graphic Designer',
    'Marketing Designer',
    'Brand Designer',
    'Design Engineer',
    'Motion Designer',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('designer', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('designer', t)).toBe(false));
});

describe('matchesPack — data_ml', () => {
  const positives = [
    'Data Scientist',
    'Senior Data Scientist',
    'Machine Learning Engineer',
    'ML Engineer, Platform',
    'Applied Scientist',
    'Head of Data',
    'Director of Data Science',
  ];
  const negatives = [
    'Data Analyst',
    'BI Developer',
    'Data Entry Specialist',
    'Marketing Analytics Manager',
    'Business Analyst',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('data_ml', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('data_ml', t)).toBe(false));
});

describe('matchesPack — gtm', () => {
  const positives = [
    'Customer Success Manager',
    'Director of Customer Success',
    'VP Customer Success',
    'Strategic Account Manager',
    'Account Director',
    'Head of Partnerships',
    'Director, Strategic Partnerships',
    'VP Partnerships',
    'Client Services Director',
    'Enterprise Account Executive, Director',
  ];
  const negatives = [
    'SDR',
    'BDR',
    'Sales Development Representative',
    'CS Analyst',
    'Retention Specialist',
    'Sales Engineer',
    'Solutions Engineer',
    'Marketing Manager',
  ];
  for (const t of positives) it(`+ ${t}`, () => expect(matchesPack('gtm', t)).toBe(true));
  for (const t of negatives) it(`- ${t}`, () => expect(matchesPack('gtm', t)).toBe(false));
});

describe('packsMatching', () => {
  it('returns all packs that match a title', () => {
    expect(packsMatching('Engineering Manager, ML')).toContain('em');
  });
  it('empty for unrelated title', () => {
    expect(packsMatching('Barista')).toEqual([]);
  });
});
```

- [ ] **Step 2: Confirm tests fail**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm test
```

Expected: `Cannot find module './packs'`.

- [ ] **Step 3: Implement**

Create `/Users/sratanjee/Beacon/lib/roles/packs.ts`:

```ts
export type RolePackId = 'em' | 'sr_ic' | 'pm' | 'designer' | 'data_ml' | 'gtm';

export type RolePack = {
  id: RolePackId;
  label: string;
  description: string;
  include: RegExp[];
  exclude: RegExp[];
};

// Each pack: exclude-first (short-circuit noise), then include.
export const ROLE_PACKS: RolePack[] = [
  {
    id: 'em',
    label: 'Engineering Manager / Head of Eng',
    description: 'People-leader roles: EM, Sr EM, Director of Eng, Head of Eng, VP Eng.',
    include: [
      /engineering manager/i,
      /\bsenior em\b/i,
      /\bhead of .{0,40}?(engineering|applied ai|applied ml|platform|infrastructure|data|ml|ai)\b/i,
      /\bdirector[,\s]+(?:of\s+)?[a-z &\/\-—,]{0,40}engineering\b/i,
      /\bvp[,\s]+(?:of\s+)?[a-z &\/\-—,]{0,40}engineering\b/i,
      /\bmanager\b[^,]{0,5},\s*[a-z &\-—]{0,30}engineering\b/i,
      /\btech(?:nical)? lead manager\b/i,
    ],
    exclude: [
      /\bsales engineer/i,
      /\bfield engineering/i,
      /\bsolution(?:s)? engineering\b/i,
      /\btechnical services\b/i,
      /\bsupport engineering\b/i,
      /\bcustomer engineering\b/i,
      /\bcustomer success\b/i,
      /\bpresales?\b/i,
      /\btechnical program manager\b/i,
      /\bprogram manager\b/i,
      /\bproject manager\b/i,
      /\bTPM\b/,
      /\benterprise sales/i,
      /\bproduct manager\b/i,
      /\bmarketing\b/i,
      /\bmanufacturing/i,
      /\btest engineering/i,
      /\bquality engineering/i,
      /\bem[ci]\b/i,
      /\bsystems test\b/i,
      /\bhardware engineering/i,
      /\bhardware reliability engineering/i,
      /\bmechanical engineering/i,
      /\belectrical engineering/i,
      /\bpharmacy\b/i,
      /\brecruit/i,
      /\bsupplier/i,
      /\bindustrialization/i,
      /\blegal engineering/i,
      /\bpeople partners?/i,
      /\bpayroll/i,
      /\bfinance systems/i,
    ],
  },
  {
    id: 'sr_ic',
    label: 'Senior IC (Staff / Principal Engineer)',
    description: 'Senior hands-on engineering: Staff, Sr Staff, Principal, Distinguished.',
    include: [
      /\bstaff (software |systems )?engineer\b/i,
      /\bsenior staff engineer\b/i,
      /\bprincipal (software |systems )?engineer\b/i,
      /\bdistinguished engineer\b/i,
      /\bstaff engineer,/i,
      /\bstaff ml engineer\b/i,
    ],
    exclude: [
      /\bmanager\b/i,
      /\bdirector\b/i,
      /\bhead of\b/i,
      /\bvp\b/i,
      /\bsales engineer/i,
      /\bfield engineer/i,
      /\bsolutions? engineer/i,
      /\bcustomer engineer/i,
    ],
  },
  {
    id: 'pm',
    label: 'Product Manager',
    description: 'Product management: PM, Sr PM, GPM, Head/Director/VP of Product.',
    include: [
      /\b(senior |sr\.? |lead |staff |principal )?product manager\b/i,
      /\bgroup product manager\b/i,
      /\bhead of product\b/i,
      /\bdirector[,\s]+(?:of\s+)?product\b/i,
      /\bvp[,\s]+(?:of\s+)?product\b/i,
    ],
    exclude: [
      /\bprogram manager\b/i,
      /\btechnical program manager\b/i,
      /\bproject manager\b/i,
      /\bproduct marketing manager\b/i,
      /\bmarketing\b/i,
      /\bengineering manager\b/i,
      /\bTPM\b/,
    ],
  },
  {
    id: 'designer',
    label: 'Product Designer / Design Leader',
    description: 'Product design and design leadership.',
    include: [
      /\b(senior |sr\.? |lead |staff |principal )?product designer\b/i,
      /\b(senior |sr\.? |lead |staff |principal )?ux designer\b/i,
      /\bdesign manager\b/i,
      /\bhead of design\b/i,
      /\bdirector[,\s]+(?:of\s+)?design\b/i,
      /\bvp[,\s]+(?:of\s+)?design\b/i,
      /\bstaff designer\b/i,
      /\bprincipal designer\b/i,
    ],
    exclude: [
      /\bgraphic designer\b/i,
      /\bmarketing designer\b/i,
      /\bbrand designer\b/i,
      /\bdesign engineer\b/i,
      /\bmotion designer\b/i,
      /\bvisual designer\b/i,
    ],
  },
  {
    id: 'data_ml',
    label: 'Data / ML',
    description: 'Data science, ML engineering, applied science, data leadership.',
    include: [
      /\b(senior |sr\.? |lead |staff |principal )?data scientist\b/i,
      /\b(senior |sr\.? |lead |staff |principal )?(machine learning|ml) engineer\b/i,
      /\b(senior |sr\.? |lead |staff |principal )?applied scientist\b/i,
      /\bhead of data\b/i,
      /\bdirector[,\s]+(?:of\s+)?data\b/i,
      /\bvp[,\s]+(?:of\s+)?data\b/i,
      /\bml manager\b/i,
      /\bmanager,?\s*(?:data science|machine learning|ml)\b/i,
    ],
    exclude: [
      /\bdata analyst\b/i,
      /\bbi developer\b/i,
      /\bdata entry\b/i,
      /\bmarketing analytics\b/i,
      /\bbusiness analyst\b/i,
      /\bfinancial analyst\b/i,
    ],
  },
  {
    id: 'gtm',
    label: 'GTM Leadership (CS / Partnerships / Enterprise)',
    description: 'Customer success, strategic accounts, partnerships, enterprise sales leadership.',
    include: [
      /\bcustomer success manager\b/i,
      /\bCSM\b/,
      /\b(director|head|vp)[,\s]+(?:of\s+)?customer success\b/i,
      /\bstrategic account (manager|director|executive)\b/i,
      /\baccount director\b/i,
      /\b(head|director|vp)[,\s]+(?:of\s+)?partnerships?\b/i,
      /\balliances director\b/i,
      /\b(director|head|vp)[,\s]+(?:of\s+)?alliances\b/i,
      /\bclient services (director|manager|lead)\b/i,
      /\b(director|head|vp)[,\s]+(?:of\s+)?client services\b/i,
      /\benterprise account executive.*(director|senior)\b/i,
      /\benterprise ae\b/i,
      /\b(head|director|vp)[,\s]+(?:of\s+)?enterprise\b/i,
    ],
    exclude: [
      /\bSDR\b/,
      /\bBDR\b/,
      /\bsales development representative\b/i,
      /\bsales associate\b/i,
      /\bcs analyst\b/i,
      /\bretention specialist\b/i,
      /\bsales engineer\b/i,
      /\bsolutions? engineer\b/i,
      /\bproduct marketing\b/i,
      /\brecruit/i,
    ],
  },
];

export function matchesPack(packId: RolePackId, title: string | null | undefined): boolean {
  if (!title) return false;
  const pack = ROLE_PACKS.find((p) => p.id === packId);
  if (!pack) return false;
  for (const re of pack.exclude) if (re.test(title)) return false;
  for (const re of pack.include) if (re.test(title)) return true;
  return false;
}

export function packsMatching(title: string | null | undefined): RolePackId[] {
  if (!title) return [];
  const out: RolePackId[] = [];
  for (const p of ROLE_PACKS) {
    if (matchesPack(p.id, title)) out.push(p.id);
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: all pass. Total should climb (existing suite + ~60 new pack tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/sratanjee/Beacon
git add lib/roles/
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add role packs (em, sr_ic, pm, designer, data_ml, gtm) with tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Data migration — Sarang → users + backfill user_id

**Files:**
- Create: `supabase/migrations/20260907020000_migrate_sarang_and_backfill.sql`

- [ ] **Step 1: Look up Sarang's auth.users UUID**

He needs an auth.users row to reference. If he doesn't have one yet, create it manually via Supabase dashboard or SQL. Run to check:

```bash
cd /Users/sratanjee/Beacon
pnpm supabase db query --linked <<'SQL'
select id, email from auth.users where email = 'sratanjee@gmail.com';
SQL
```

If empty: manually create in Supabase Studio → Authentication → Users → Add User → Email `sratanjee@gmail.com`, generate a link (don't email it), copy the UUID.

Save the UUID in a variable for the next step. **Sarang or the controller must supply this UUID** before proceeding; embed it in the migration file below where marked `<SARANG_UUID>`.

- [ ] **Step 2: Write the migration**

Create `/Users/sratanjee/Beacon/supabase/migrations/20260907020000_migrate_sarang_and_backfill.sql` (**replace `<SARANG_UUID>` with the actual UUID from Step 1**):

```sql
-- Migrate Sarang's data from profiles singleton into users, then backfill
-- user_id on fit_scores / generated_docs / job_states.

-- 1. Insert Sarang's user row.
insert into users (id, email, display_name, role, role_pack, positioning, resume_pdf_path, resume_text)
select
  '<SARANG_UUID>'::uuid,
  'sratanjee@gmail.com',
  'Sarang',
  'admin',
  'em',
  positioning,
  resume_pdf_path,
  resume_text
from profiles
where id = 1
on conflict (id) do update
  set positioning     = excluded.positioning,
      resume_pdf_path = excluded.resume_pdf_path,
      resume_text     = excluded.resume_text;

-- 2. Sarang goes on his own allowlist so he can log in via magic link too.
insert into invited_emails (email, invited_by)
values ('sratanjee@gmail.com', '<SARANG_UUID>'::uuid)
on conflict (email) do nothing;

-- 3. Backfill user_id on existing per-user rows. Everything currently in DB
-- belongs to Sarang.
update fit_scores     set user_id = '<SARANG_UUID>'::uuid where user_id is null;
update generated_docs set user_id = '<SARANG_UUID>'::uuid where user_id is null;
update job_states     set user_id = '<SARANG_UUID>'::uuid where user_id is null;

-- 4. Rebuild composite primary keys now that user_id is populated.
alter table fit_scores      drop constraint fit_scores_pkey;
alter table fit_scores      add primary key (job_id, user_id);
alter table fit_scores      alter column user_id set not null;

alter table generated_docs  drop constraint generated_docs_pkey;
alter table generated_docs  add primary key (job_id, kind, user_id);
alter table generated_docs  alter column user_id set not null;

alter table job_states      drop constraint job_states_pkey;
alter table job_states      add primary key (job_id, user_id);
alter table job_states      alter column user_id set not null;
```

- [ ] **Step 3: Push + verify**

```bash
cd /Users/sratanjee/Beacon
printf 'Y\n' | pnpm supabase db push
pnpm supabase db query --linked <<'SQL'
select
  (select count(*) from users where email='sratanjee@gmail.com') as users_row,
  (select count(*) from fit_scores where user_id is not null) as fs_backfilled,
  (select count(*) from generated_docs where user_id is not null) as gd_backfilled,
  (select count(*) from job_states where user_id is not null) as js_backfilled;
SQL
```

Expected: `users_row = 1`; the backfill counts match the total row counts of each table pre-migration.

- [ ] **Step 4: Commit**

```bash
cd /Users/sratanjee/Beacon
git add supabase/migrations/20260907020000_migrate_sarang_and_backfill.sql
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Migration: Sarang → users; backfill user_id + composite PKs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Populate job_role_matches for existing jobs

**Files:**
- Create: `scripts/backfill-role-matches.mjs`

- [ ] **Step 1: Write the script**

Create `/Users/sratanjee/Beacon/scripts/backfill-role-matches.mjs`:

```mjs
// Backfill job_role_matches for every existing job across all 6 role packs.
// Run once after Task 3. Idempotent (uses on conflict do nothing).

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve('server-only');
require.cache[serverOnlyPath] = { id: serverOnlyPath, filename: serverOnlyPath, loaded: true, exports: {} };

import { createClient } from '@supabase/supabase-js';
const { ROLE_PACKS, matchesPack } = await import('../lib/roles/packs.ts');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });

console.log('Loading jobs...');
const { data: jobs, error } = await db.from('jobs').select('id, title').eq('is_active', true);
if (error) throw error;
console.log(`Loaded ${jobs.length} active jobs`);

const rows = [];
for (const j of jobs) {
  for (const p of ROLE_PACKS) {
    if (matchesPack(p.id, j.title)) rows.push({ job_id: j.id, role_pack: p.id });
  }
}
console.log(`Computed ${rows.length} match rows`);

// Insert in batches of 500 to avoid payload limits.
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500);
  const { error: err } = await db.from('job_role_matches').upsert(batch, { onConflict: 'job_id,role_pack', ignoreDuplicates: true });
  if (err) throw err;
  console.log(`  ${Math.min(i + 500, rows.length)}/${rows.length}`);
}

const counts = {};
for (const p of ROLE_PACKS) {
  const { count } = await db.from('job_role_matches').select('*', { count: 'exact', head: true }).eq('role_pack', p.id);
  counts[p.id] = count;
}
console.log('Match counts per pack:', counts);
```

- [ ] **Step 2: Rename to .ts and run via tsx (avoids the .mjs → .ts import friction)**

```bash
cd /Users/sratanjee/Beacon
mv scripts/backfill-role-matches.mjs scripts/backfill-role-matches.ts
# Change import extension inside the file: '../lib/roles/packs.ts' → '../lib/roles/packs'
pnpm add -D tsx
export $(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' .env.local | xargs)
pnpm exec tsx scripts/backfill-role-matches.ts
```

Expected: script logs total loaded, computed match rows, batch progress, and final counts per pack. `em` should be ~450-500 (matching pre-migration count); others in the 50-500 range.

- [ ] **Step 3: Commit script (do not commit .env.local values)**

```bash
cd /Users/sratanjee/Beacon
git add scripts/backfill-role-matches.mjs
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add one-time script to backfill job_role_matches for all packs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Auth user helpers (server-side)

**Files:**
- Create: `lib/auth/user.ts`

- [ ] **Step 1: Write the module**

Create `/Users/sratanjee/Beacon/lib/auth/user.ts`:

```ts
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { redirect } from 'next/navigation';

export type BeaconUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'user' | 'admin';
  role_pack: 'em' | 'sr_ic' | 'pm' | 'designer' | 'data_ml' | 'gtm' | null;
};

// Server component / route helper that returns the current logged-in user
// hydrated from the users table. Returns null if not logged in or if the
// auth session exists but no matching users row (edge case during onboarding).
export async function getCurrentUser(): Promise<BeaconUser | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase env vars missing');

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) cookieStore.set(name, value, options);
      },
    },
  });

  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data } = await supabase
    .from('users')
    .select('id, email, display_name, role, role_pack')
    .eq('id', authUser.id)
    .maybeSingle();
  return (data as BeaconUser | null) ?? null;
}

export async function requireUser(): Promise<BeaconUser> {
  const u = await getCurrentUser();
  if (!u) redirect('/login');
  return u;
}

export async function requireAdmin(): Promise<BeaconUser> {
  const u = await requireUser();
  if (u.role !== 'admin') redirect('/dashboard');
  return u;
}
```

- [ ] **Step 2: Install @supabase/ssr if not present**

Run:
```bash
cd /Users/sratanjee/Beacon
pnpm ls @supabase/ssr 2>&1 | head -3
# if not installed:
pnpm add @supabase/ssr
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/sratanjee/Beacon
git add lib/auth/user.ts package.json pnpm-lock.yaml
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add lib/auth/user.ts — getCurrentUser / requireUser / requireAdmin

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Magic-link auth routes (allowlist-gated request + callback)

**Files:**
- Create: `app/api/auth/request-link/route.ts`
- Create: `app/api/auth/callback/route.ts`
- Create: `app/logout/route.ts`

- [ ] **Step 1: Request-link route**

Create `/Users/sratanjee/Beacon/app/api/auth/request-link/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getServiceClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.redirect(new URL('/login?error=1', req.url), 303);
  }

  // Allowlist check first — no leak of "email known" vs "not allowed."
  const admin = getServiceClient();
  const { data: invite } = await admin
    .from('invited_emails')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  if (!invite) {
    // Reuse the same message regardless of the reason.
    return NextResponse.redirect(new URL('/login?sent=1', req.url), 303);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        },
      },
    },
  );
  const origin = req.headers.get('origin') ?? new URL(req.url).origin;
  await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/api/auth/callback`,
    },
  });

  return NextResponse.redirect(new URL('/login?sent=1', req.url), 303);
}
```

- [ ] **Step 2: Callback route**

Create `/Users/sratanjee/Beacon/app/api/auth/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/login?error=1', req.url));

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        },
      },
    },
  );
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL('/login?error=1', req.url));

  // Ensure a users row exists (first-time login).
  const admin = getServiceClient();
  const { data: existing } = await admin.from('users').select('id, role_pack').eq('id', data.user.id).maybeSingle();
  if (!existing) {
    await admin.from('users').insert({
      id: data.user.id,
      email: data.user.email!,
      display_name: null,
      role: 'user',
      role_pack: null,
    });
    return NextResponse.redirect(new URL('/onboarding', req.url));
  }
  if (!existing.role_pack) {
    return NextResponse.redirect(new URL('/onboarding', req.url));
  }
  return NextResponse.redirect(new URL('/dashboard', req.url));
}
```

- [ ] **Step 3: Logout route**

Create `/Users/sratanjee/Beacon/app/logout/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        },
      },
    },
  );
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', req.url), 303);
}
```

- [ ] **Step 4: Rewrite /login page (email-only form)**

Overwrite `/Users/sratanjee/Beacon/app/login/page.tsx`:

```tsx
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
```

- [ ] **Step 5: Retire the old /api/login route**

Delete `/Users/sratanjee/Beacon/app/api/login/route.ts`:
```bash
cd /Users/sratanjee/Beacon
rm app/api/login/route.ts
```

- [ ] **Step 6: Typecheck + build**

```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -12
```

Expected: clean; new routes registered.

- [ ] **Step 7: Commit**

```bash
cd /Users/sratanjee/Beacon
git add app/api/auth/ app/logout/ app/login/page.tsx
git rm app/api/login/route.ts
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Auth: magic-link + allowlist + first-login provisioning

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Middleware swap to Supabase session

**Files:**
- Modify: `middleware.ts`

- [ ] **Step 1: Rewrite middleware**

Overwrite `/Users/sratanjee/Beacon/middleware.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATHS = new Set(['/login']);
const PUBLIC_PATH_PREFIXES = ['/api/auth/', '/api/run-weekly-scan'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) res.cookies.set(name, value, options);
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const next = pathname + req.nextUrl.search;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, req.url));
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/|favicon\\.ico|.*\\..*).*)'],
};
```

- [ ] **Step 2: Typecheck + build**

```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -12
```

- [ ] **Step 3: Commit**

```bash
cd /Users/sratanjee/Beacon
git add middleware.ts
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Middleware: swap HMAC cookie for Supabase session

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Onboarding page + role-pack picker + resume upload

**Files:**
- Create: `app/onboarding/page.tsx`
- Create: `app/api/onboarding/route.ts`

- [ ] **Step 1: Onboarding page**

Create `/Users/sratanjee/Beacon/app/onboarding/page.tsx`:

```tsx
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
      <p className="mt-2 text-sm text-zinc-500">Three quick steps and you're in.</p>

      <section className="mt-8 rounded border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">1. Pick a role pack</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Determines which job titles show up in your dashboard.
        </p>
        <form method="post" action="/api/onboarding" className="mt-4 space-y-2">
          {ROLE_PACKS.map((p) => (
            <label key={p.id} className="flex items-start gap-3 rounded border border-zinc-200 p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/40">
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
        Done all three? <Link href="/dashboard" className="underline">Go to your dashboard →</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Role-pack save route**

Create `/Users/sratanjee/Beacon/app/api/onboarding/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/user';
import { ROLE_PACKS } from '@/lib/roles/packs';
import { getServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const form = await req.formData();
  const rolePack = String(form.get('role_pack') ?? '');
  const valid = ROLE_PACKS.some((p) => p.id === rolePack);
  if (!valid) return NextResponse.redirect(new URL('/onboarding', req.url), 303);

  const db = getServiceClient();
  const { error } = await db
    .from('users')
    .update({ role_pack: rolePack, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.redirect(new URL('/onboarding', req.url), 303);
}
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -12
```

- [ ] **Step 4: Commit**

```bash
cd /Users/sratanjee/Beacon
git add app/onboarding/ app/api/onboarding/
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Onboarding: role pack picker + link to resume upload + positioning

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Scope all per-user routes to current user

**Files:** (each modified to read/write via `requireUser()` and add `user_id` filters)
- Modify: `app/api/resume/upload/route.ts`
- Modify: `app/api/positioning/route.ts`
- Modify: `app/api/jobs/[id]/generate/route.ts`
- Modify: `app/api/jobs/[id]/download/route.ts`
- Modify: `app/api/jobs/[id]/state/route.ts`
- Modify: `app/api/rewrite-resume/route.ts`
- Modify: `app/api/score-all/route.ts`
- Modify: `app/resume/page.tsx`
- Modify: `app/dashboard/page.tsx`
- Modify: `app/jobs/[id]/page.tsx`

- [ ] **Step 1: Resume upload → users**

Read `/Users/sratanjee/Beacon/app/api/resume/upload/route.ts`. Replace the `db.from('profiles').upsert(...)` call and its `.eq('id', 1)` reads with:

```ts
import { requireUser } from '@/lib/auth/user';
// ... inside POST:
const user = await requireUser();
// ...
const upsertRes = await db
  .from('users')
  .update({
    resume_pdf_path: path,
    resume_text: extracted.text,
    updated_at: new Date().toISOString(),
  })
  .eq('id', user.id)
  .select('id, updated_at')
  .single();
```

Return the same JSON shape.

- [ ] **Step 2: Positioning save → users**

Read `/Users/sratanjee/Beacon/app/api/positioning/route.ts`. Replace `profiles` upsert with:

```ts
import { requireUser } from '@/lib/auth/user';
// ... inside POST:
const user = await requireUser();
// ...
const upsert = await db.from('users').update({
  positioning: positioning || null,
  updated_at: new Date().toISOString(),
}).eq('id', user.id);
```

- [ ] **Step 3: Generate route → per-user**

Read `/Users/sratanjee/Beacon/app/api/jobs/[id]/generate/route.ts`. Add at the top of the handler:

```ts
import { requireUser } from '@/lib/auth/user';
// ...
const user = await requireUser();
```

Change every `generated_docs` query to include `.eq('user_id', user.id)`, and the upsert to include `user_id: user.id`. Change the profile read from `.from('profiles').eq('id', 1)` to `.from('users').eq('id', user.id)`.

- [ ] **Step 4: Download route → per-user**

Read `/Users/sratanjee/Beacon/app/api/jobs/[id]/download/route.ts`. Add `requireUser()` and scope the `generated_docs` query:

```ts
const user = await requireUser();
// ...
const [docRes, jobRes] = await Promise.all([
  db
    .from('generated_docs')
    .select('text')
    .eq('job_id', jobId)
    .eq('kind', kind)
    .eq('user_id', user.id)   // <-- new
    .maybeSingle(),
  db.from('jobs').select('id, companies!inner(name)').eq('id', jobId).maybeSingle(),
]);
```

- [ ] **Step 5: State route → per-user**

Read `/Users/sratanjee/Beacon/app/api/jobs/[id]/state/route.ts`. Add `requireUser()` and scope all `job_states` queries by `.eq('user_id', user.id)`. Upsert includes `user_id: user.id`.

- [ ] **Step 6: Rewrite-resume route → per-user**

Read `/Users/sratanjee/Beacon/app/api/rewrite-resume/route.ts`. Change profile read from `.from('profiles').eq('id', 1)` to `.from('users').eq('id', user.id)` where `user = await requireUser()`.

- [ ] **Step 7: Score-all route → per-user**

Read `/Users/sratanjee/Beacon/app/api/score-all/route.ts`. Pass the current user's UUID into `runScoring` (which is modified in Task 10):

```ts
const user = await requireUser();
const summary = await runScoring({ force, userId: user.id });
```

- [ ] **Step 8: /resume page → per-user**

Read `/Users/sratanjee/Beacon/app/resume/page.tsx`. Replace `profileRes` read with:

```ts
const user = await requireUser();
const profileRes = await db
  .from('users')
  .select('resume_pdf_path, resume_text, positioning, updated_at')
  .eq('id', user.id)
  .maybeSingle();
```

The scored-vs-total counts should also filter by `user_id`:

```ts
const [emCountRes, scoredCountRes] = await Promise.all([
  db
    .from('jobs')
    .select('id, job_role_matches!inner(role_pack)', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('job_role_matches.role_pack', user.role_pack!),
  db
    .from('fit_scores')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id),
]);
```

- [ ] **Step 9: /dashboard page → per-user**

Read `/Users/sratanjee/Beacon/app/dashboard/page.tsx` (it's the largest file — ~450 lines). Changes:

1. At the top, add:
```ts
import { requireUser } from '@/lib/auth/user';
// ... inside Dashboard function:
const user = await requireUser();
```

2. Replace `title_matches_role` filter with `job_role_matches` join:
```ts
let query = db
  .from('jobs')
  .select(
    'id, title, url, location, remote_ok, comp_min, comp_max, first_seen_at, ' +
      'companies!inner(name, notable_lists), ' +
      'fit_scores!left(overall_score, rationale), ' +
      'job_states!left(is_saved, applied_at), ' +
      'job_role_matches!inner(role_pack)',
  )
  .eq('is_active', true)
  .eq('job_role_matches.role_pack', user.role_pack!)
  .eq('fit_scores.user_id', user.id)
  .eq('job_states.user_id', user.id);
```

3. Replace `hasResume` check with `!!user`; require role_pack before showing table:
```ts
if (!user.role_pack) redirect('/onboarding');
```

4. Replace the singleton `.from('profiles').select('id').eq('id', 1)` with just checking `user.resume_text` (needs the read expanded — add resume_text to `requireUser` return or query separately).

Simplest: modify `getCurrentUser` to also return `resume_text_present: boolean`. Update `lib/auth/user.ts` accordingly:

```ts
export type BeaconUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'user' | 'admin';
  role_pack: RolePackId | null;
  has_resume: boolean;
};
```

And change the `.select('id, email, display_name, role, role_pack')` line to `.select('id, email, display_name, role, role_pack, resume_text')` with `has_resume: !!(data as any).resume_text`.

5. Add avatar/menu in header (top-right of dashboard):
```tsx
<div className="flex items-baseline gap-3">
  <span className="text-sm text-zinc-500">{user.email}</span>
  <form method="post" action="/logout" className="inline">
    <button type="submit" className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
      log out
    </button>
  </form>
</div>
```

- [ ] **Step 10: /jobs/[id] page → per-user**

Read `/Users/sratanjee/Beacon/app/jobs/[id]/page.tsx`. Add `requireUser()` at top; scope the query:

```ts
const user = await requireUser();
// ...
const jobRes = await db
  .from('jobs')
  .select(
    'id, title, url, location, remote_ok, comp_min, comp_max, first_seen_at, description_text, ' +
      'companies!inner(id, name, notable_lists), ' +
      'fit_scores!left(overall_score, domain_proximity_score, seniority_match_score, comp_signal, rationale), ' +
      'job_states!left(is_saved, applied_at)',
  )
  .eq('id', jobId)
  .eq('fit_scores.user_id', user.id)
  .eq('job_states.user_id', user.id)
  .maybeSingle();
```

Scope the generated-docs reads too:
```ts
const [coverRes, resumeRes] = await Promise.all([
  db.from('generated_docs').select('text, generated_at, model').eq('job_id', jobId).eq('kind', 'cover_letter').eq('user_id', user.id).maybeSingle(),
  db.from('generated_docs').select('text, generated_at, model').eq('job_id', jobId).eq('kind', 'tailored_resume').eq('user_id', user.id).maybeSingle(),
]);
```

- [ ] **Step 11: Typecheck + build**

```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -12
```

Expected: clean.

- [ ] **Step 12: Commit**

```bash
cd /Users/sratanjee/Beacon
git add app/
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Scope all per-user routes/pages by requireUser + user_id

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Scan pipeline populates job_role_matches + per-user scoring loop

**Files:**
- Modify: `lib/pipeline/scan.ts`
- Modify: `lib/scoring/run.ts`

- [ ] **Step 1: Scan populates job_role_matches**

Read `/Users/sratanjee/Beacon/lib/pipeline/scan.ts`. Import role packs:

```ts
import { ROLE_PACKS, matchesPack } from '@/lib/roles/packs';
```

In `upsertJobs`, after the main `.upsert(rows, ...)` call, add a follow-up upsert for role matches:

```ts
const matchRows: { job_id: number; role_pack: string }[] = [];
// After the jobs upsert returns, we need job ids. Query them:
const { data: upserted } = await db
  .from('jobs')
  .select('id, external_id, title')
  .eq('company_id', company.id)
  .in('external_id', jobs.map((j) => j.external_id));
for (const row of upserted ?? []) {
  for (const pack of ROLE_PACKS) {
    if (matchesPack(pack.id, row.title)) matchRows.push({ job_id: row.id, role_pack: pack.id });
  }
}
if (matchRows.length > 0) {
  await db.from('job_role_matches').upsert(matchRows, { onConflict: 'job_id,role_pack', ignoreDuplicates: true });
}
```

Also remove the `title_matches_role: matchesEmRole(j.title)` field from the upsert rows map (that column is being retired in Task 11).

- [ ] **Step 2: Scoring loops over all users**

Read `/Users/sratanjee/Beacon/lib/scoring/run.ts`. Change the signature and logic:

```ts
export async function runScoring(options: { force?: boolean; userId?: string } = {}): Promise<ScoringSummary> {
  const db = getServiceClient();

  // If userId given: score just for that user.
  // Otherwise: iterate all users with a resume + role_pack.
  const users = options.userId
    ? [{ id: options.userId }]
    : ((await db.from('users').select('id').not('resume_text', 'is', null).not('role_pack', 'is', null)).data ?? []);

  let totalScored = 0;
  const errors: { job_id: number; error: string }[] = [];

  for (const u of users) {
    const result = await scoreForUser(db, u.id, options.force);
    totalScored += result.scored;
    for (const e of result.errors) errors.push(e);
    if (result.time_budget_hit) {
      return { scored: totalScored, failed: errors.length, skipped_no_resume: false, time_budget_hit: true, errors };
    }
  }
  return { scored: totalScored, failed: errors.length, skipped_no_resume: false, time_budget_hit: false, errors };
}
```

Extract the per-user scoring into `scoreForUser(db, userId, force)` — full body:

```ts
async function scoreForUser(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  force: boolean,
): Promise<{ scored: number; errors: { job_id: number; error: string }[]; time_budget_hit: boolean }> {
  const startedAt = Date.now();
  const userRes = await db
    .from('users')
    .select('resume_text, positioning, role_pack')
    .eq('id', userId)
    .maybeSingle();
  const resumeText = userRes.data?.resume_text?.trim();
  const positioning = userRes.data?.positioning?.trim() || null;
  const rolePack = userRes.data?.role_pack;
  if (!resumeText || !rolePack) return { scored: 0, errors: [], time_budget_hit: false };

  const key = process.env.ANTHROPIC_API_KEY!;
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    apiKey: key,
    defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined,
  });
  const systemPrompt = buildSystemPrompt(resumeText, positioning);

  if (force) {
    await db.from('fit_scores').delete().eq('user_id', userId);
  }

  const [emRes, scoredRes] = await Promise.all([
    db
      .from('jobs')
      .select('id, title, location, description_text, companies!inner(name), job_role_matches!inner(role_pack)')
      .eq('is_active', true)
      .eq('job_role_matches.role_pack', rolePack)
      .limit(1000),
    db.from('fit_scores').select('job_id').eq('user_id', userId),
  ]);
  if (emRes.error) throw new Error(emRes.error.message);
  const scoredIds = new Set((scoredRes.data ?? []).map((r) => r.job_id));
  const jobs = ((emRes.data ?? []) as unknown as UnscoredJob[]).filter((j) => !scoredIds.has(j.id));

  const errors: { job_id: number; error: string }[] = [];
  let scored = 0;
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    if (Date.now() - startedAt > SOFT_BUDGET_MS) {
      return { scored, errors, time_budget_hit: true };
    }
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (job) => {
        try {
          const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: buildUserPrompt({
              title: job.title,
              company: job.companies?.name ?? 'unknown',
              location: job.location,
              description_text: job.description_text,
            })}],
          });
          const block = response.content[0];
          if (!block || block.type !== 'text') throw new Error('unexpected block type');
          const text = block.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
          const parsed = JSON.parse(text) as ScoreResponse;
          return { job, parsed, err: null as string | null };
        } catch (e) {
          return { job, parsed: null, err: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    const inserts = results.filter((r) => r.parsed !== null).map((r) => ({
      job_id: r.job.id,
      user_id: userId,
      domain_proximity_score: r.parsed!.domain_proximity,
      seniority_match_score: r.parsed!.seniority_match,
      comp_signal: r.parsed!.comp_signal,
      overall_score: r.parsed!.overall_score,
      rationale: r.parsed!.rationale,
      scored_at: new Date().toISOString(),
    }));
    if (inserts.length > 0) {
      const upsertRes = await db.from('fit_scores').upsert(inserts, { onConflict: 'job_id,user_id' });
      if (upsertRes.error) {
        for (const ins of inserts) errors.push({ job_id: ins.job_id, error: upsertRes.error.message });
      } else {
        scored += inserts.length;
      }
    }
    for (const r of results) if (r.err) errors.push({ job_id: r.job.id, error: r.err });
  }
  return { scored, errors, time_budget_hit: false };
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm test
```

- [ ] **Step 4: Commit**

```bash
cd /Users/sratanjee/Beacon
git add lib/pipeline/scan.ts lib/scoring/run.ts
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Scan: populate job_role_matches; scoring: loop across all users

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Drop deprecated schema

**Files:**
- Create: `supabase/migrations/20260907030000_drop_legacy.sql`

- [ ] **Step 1: Migration**

Create `/Users/sratanjee/Beacon/supabase/migrations/20260907030000_drop_legacy.sql`:

```sql
alter table jobs drop column if exists title_matches_role;
drop table if exists profiles;
```

- [ ] **Step 2: Push**

```bash
cd /Users/sratanjee/Beacon
printf 'Y\n' | pnpm supabase db push
```

- [ ] **Step 3: Commit**

```bash
cd /Users/sratanjee/Beacon
git add supabase/migrations/20260907030000_drop_legacy.sql
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Migration: drop legacy profiles + title_matches_role

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Admin invites page

**Files:**
- Create: `app/admin/invites/page.tsx`
- Create: `app/api/admin/invites/route.ts`

- [ ] **Step 1: Invites page**

Create `/Users/sratanjee/Beacon/app/admin/invites/page.tsx`:

```tsx
import { requireAdmin } from '@/lib/auth/user';
import { getServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Invites() {
  const admin = await requireAdmin();
  const db = getServiceClient();
  const [invitesRes, usersRes] = await Promise.all([
    db.from('invited_emails').select('email, invited_at').order('invited_at', { ascending: false }),
    db.from('users').select('id, email, display_name, role_pack, resume_text, created_at').order('created_at', { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Admin — Invites</h1>
      <p className="mt-1 text-sm text-zinc-500">Logged in as {admin.email}</p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Add invite</h2>
        <form method="post" action="/api/admin/invites" className="mt-2 flex gap-2">
          <input type="email" name="email" required placeholder="friend@example.com" className="flex-1 rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          <button type="submit" className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            Invite
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Invited ({invitesRes.data?.length ?? 0})</h2>
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {(invitesRes.data ?? []).map((i) => (
            <li key={i.email} className="flex items-center justify-between py-2 text-sm">
              <span>{i.email}</span>
              <form method="post" action={`/api/admin/invites?email=${encodeURIComponent(i.email)}&_method=delete`}>
                <button type="submit" className="text-xs text-red-600 hover:underline dark:text-red-400">
                  revoke
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Users ({usersRes.data?.length ?? 0})</h2>
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {(usersRes.data ?? []).map((u) => (
            <li key={u.id} className="py-2 text-sm">
              <div>{u.email} · <span className="text-zinc-500">{u.role_pack ?? 'onboarding'}</span> · {u.resume_text ? 'resume ✓' : 'no resume'}</div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: API route**

Create `/Users/sratanjee/Beacon/app/api/admin/invites/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/user';
import { getServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  const url = new URL(req.url);
  const method = url.searchParams.get('_method');
  if (method === 'delete') {
    const email = String(url.searchParams.get('email') ?? '').trim().toLowerCase();
    if (!email) return NextResponse.redirect(new URL('/admin/invites', req.url), 303);
    await getServiceClient().from('invited_emails').delete().eq('email', email);
    return NextResponse.redirect(new URL('/admin/invites', req.url), 303);
  }
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!email) return NextResponse.redirect(new URL('/admin/invites', req.url), 303);
  await getServiceClient()
    .from('invited_emails')
    .insert({ email, invited_by: admin.id })
    .then((r) => r.error && console.warn('invite insert:', r.error.message));
  return NextResponse.redirect(new URL('/admin/invites', req.url), 303);
}
```

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/sratanjee/Beacon
pnpm exec tsc --noEmit
pnpm exec next build 2>&1 | tail -12
```

- [ ] **Step 4: Commit**

```bash
cd /Users/sratanjee/Beacon
git add app/admin/ app/api/admin/
git -c user.email="sratanjee@gmail.com" -c user.name="sratanjee" commit -m "$(cat <<'EOF'
Add /admin/invites — allowlist management

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Company universe expansion (GTM-heavy adds)

**Files:** none (SQL run inline)

- [ ] **Step 1: Probe candidates via inline shell loop**

```bash
for entry in "veeva" "klaviyo" "iterable" "braze" "segment" "fivetran" "dbtlabs" "salesloft" "gong" "outreach" "zoominfo" "hex" "motherduck" "snowplow" "tealium" "twiliosegment" "mparticle" "rudderstack" "metabase" "front" "freshworks" "salesforce" "workday" "adobe" "asana" "workato" "tray" "zapier"; do
  gh=$(curl -s -o /dev/null -w "%{http_code}" "https://boards-api.greenhouse.io/v1/boards/${entry}/jobs")
  as=$(curl -s -o /dev/null -w "%{http_code}" "https://api.ashbyhq.com/posting-api/job-board/${entry}")
  lv=$(curl -s -o /dev/null -w "%{http_code}" "https://api.lever.co/v0/postings/${entry}?mode=json")
  [ "$gh" = "200" ] && echo "greenhouse:${entry}"
  [ "$gh" != "200" ] && [ "$as" = "200" ] && echo "ashby:${entry}"
  [ "$gh" != "200" ] && [ "$as" != "200" ] && [ "$lv" = "200" ] && echo "lever:${entry}"
done 2>&1
```

Take the hits and build an INSERT using the same idempotent CTE pattern from Task P5 (top_ai seeding).

- [ ] **Step 2: Insert hits inline**

Take the confirmed hits from Step 1 and construct an inline SQL upsert. Template (replace the values list with actual hits from your probe):

```bash
cd /Users/sratanjee/Beacon
pnpm supabase db query --linked <<'SQL'
with new_gtm (name, ats_type, ats_slug) as (values
  ('Veeva',    'greenhouse', 'veeva'),
  ('Klaviyo',  'greenhouse', 'klaviyo'),
  ('Gong',     'greenhouse', 'gong'),
  ('Outreach', 'greenhouse', 'outreach'),
  ('Salesloft','greenhouse', 'salesloft'),
  ('Braze',    'greenhouse', 'braze'),
  ('Fivetran', 'greenhouse', 'fivetran'),
  ('dbt Labs', 'ashby',      'dbtlabs'),
  ('Metabase', 'greenhouse', 'metabase'),
  ('Iterable', 'greenhouse', 'iterable'),
  ('Front',    'ashby',      'front')
  -- extend with more confirmed hits from Step 1
)
insert into companies (name, ats_type, ats_slug)
select name, ats_type, ats_slug from new_gtm
on conflict (lower(name)) do update
  set ats_type = excluded.ats_type, ats_slug = excluded.ats_slug;
SQL
```

Only include names + slugs that Step 1 verified as returning 200 from an ATS API.

- [ ] **Step 3: Trigger scan to pull jobs from new companies**

```bash
CRON_SECRET=$(grep '^CRON_SECRET=' /Users/sratanjee/Beacon/.env.local | cut -d= -f2)
curl -sS -X POST -H "authorization: Bearer $CRON_SECRET" --max-time 800 https://beacon-one-rosy.vercel.app/api/run-weekly-scan | python3 -m json.tool
```

- [ ] **Step 4: No commit (data-only, seeded via runtime SQL — company universe is DB state, not code)**

---

## Task 14: Deploy + invite Jared + smoke test end-to-end

**Files:** none (runtime verification)

- [ ] **Step 1: Push all commits + deploy**

```bash
cd /Users/sratanjee/Beacon
git push
vercel --prod --yes
```

- [ ] **Step 2: Verify existing user (Sarang) still works**

- Visit https://mybeacon.sh
- Redirected to /login
- Enter sratanjee@gmail.com → check email → click link
- Land on /dashboard with all existing state (12 great fits, saved jobs, cover letters)

If anything's missing, investigate the migration.

- [ ] **Step 3: Invite Jared**

- Log into /admin/invites
- Add `biojared@gmail.com` (Jared's email per his resume)
- Confirm invited_emails now has 2 entries

- [ ] **Step 4: Simulate Jared's flow (or ask him to do it live)**

Options:
- **Sarang runs through it in an incognito window using biojared@gmail.com** — verify magic-link email arrives, click → onboarding → picks GTM pack → uploads Jared's resume PDF → sets positioning → lands on empty dashboard (until next scan).
- **Or**: hand Jared the URL + password, let him do it end-to-end while you watch.

Immediately trigger a per-user scoring backfill:
```bash
curl -sS -b <jared-cookie> -X POST https://beacon-one-rosy.vercel.app/api/score-all | python3 -m json.tool
```

Expected: `scored` count roughly matches the GTM-pack job count from Task 4 (~200-400).

- [ ] **Step 5: Verify isolation**

- As Jared: dashboard shows GTM roles, no EM roles; save a job.
- As Sarang: dashboard still shows EM roles, does NOT show Jared's saved job.
- As Jared: `/api/jobs/<sarang's-supabase-job-id>/download?kind=cover_letter` returns 404 (no letter generated for that job by Jared).

- [ ] **Step 6: Cost check after 24h**

Look at Anthropic console → usage in the last day. Expect < $0.50 for Sarang's usage + Jared's onboarding.

---

## Verification checklist (before marking done)

- [ ] `pnpm test` passes (add ~60 new role-pack tests)
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `pnpm exec next build` compiles; all new routes registered
- [ ] All 3 migrations applied on prod DB
- [ ] Sarang's login flow works end-to-end via magic link
- [ ] Sarang's existing dashboard state intact (great fits, saved jobs, cover letters)
- [ ] Admin invites page adds/revokes emails; Sarang shows as admin
- [ ] Jared logs in via invite, completes onboarding, sees GTM-scoped dashboard
- [ ] Cross-user isolation: Jared can't see Sarang's data via URL guessing
- [ ] Company universe grew by ~15-25 GTM-relevant additions
- [ ] Anthropic cost projection holds (~$1-2/week at 2-5 users)
