# Phase 2 — Title Filter (Layer 1)

## Purpose

Slim the 14,962 raw postings currently in `jobs` down to the ~300-500 that plausibly
represent EM / Senior EM / Head of Eng / Director of Eng roles in the domains
Sarang works in (software, product, platform, infra, ML/AI, mobile, web).

This is Layer 1 of the two-layer scoring pipeline defined in `docs/Beacon_Spec.md`
§5. Its job is **high recall, tolerable precision**: get every plausible candidate
through the gate cheaply, so Phase 3 (Claude scoring) only pays tokens on rows
worth judging.

## Success criteria

- Boolean `title_matches_role` on every existing `jobs` row after backfill.
- New rows written by `scan.ts` get the flag set at upsert time (no separate pass).
- Applied against the current DB, expect 300-500 survivors out of 14,962.
- Unit tests cover ≥ 20 real-title cases pulled from `jobs`, split include/exclude.
- No change to the fetcher contracts (`NormalizedJob`) — filter is downstream of
  fetch.

## Filter logic

Two regex passes, both case-insensitive. A row is a match iff **include matches
AND exclude does not match**.

### Include (high recall)

```
Engineering Manager
Manager,?\s*(Software|Product|Platform|Infrastructure|Data|ML|AI|Backend|Frontend|Mobile|Web|Growth|Analytics|Security|Site Reliability|SRE|DevOps)\s*Engineering
Head of\s*(Engineering|Platform|Infrastructure|Data|ML|AI|Product Engineering|Applied AI|Applied ML)
Director of Engineering
Director,?\s*Engineering
Director of\s*(ML|AI|Security|Platform|Data|Applied)\s*Engineering
Director\s*[-—]\s*.*Engineering
VP,?\s*Engineering
VP of Engineering
Senior EM\b
```

Consolidated as one alternation in code, but broken out here for review.

### Exclude (precision guard)

```
Sales Engineer
Field Engineering
Enterprise Sales
Product Manager                          # spec §5
Marketing                                # spec §5
Manufacturing                            # user preference
Test Engineering
Quality Engineering
EM[CI]                                   # EMC/EMI test roles
Reliability Engineering(?!.*Software)    # keeps "Site Reliability", rejects Hardware Reliability
Systems Test
Hardware Engineering(?!.*Software)
Mechanical Engineering
Electrical Engineering(?!.*Software)
Pharmacy
Recruiting
Supplier
Industrialization
Legal Engineering
People Partners
Payroll
Finance Systems
```

Sales Engineering / Field Engineering are pre-sales roles; excluded even though
they say "Engineering Manager". Field Application / Application Engineering
similarly.

### Why not run Claude on titles for Layer 1

Considered; deferred. Spec §5 intentionally separates cheap Layer 1 (regex) from
expensive Layer 2 (Claude). Layer 1 with high recall is enough — Phase 3's
scorer will catch what regex over-admits. Adding Claude here would double-spend
on tokens Phase 3 already pays.

## Storage

Add one column to `jobs`:

```sql
alter table jobs
  add column title_matches_role boolean not null default false;

create index jobs_title_matches_active_idx
  on jobs (title_matches_role, last_seen_at desc)
  where is_active;
```

The partial index over active rows is the shape Phase 3 will query
(`WHERE title_matches_role AND is_active AND not-yet-scored`).

**Why a column, not a view or generated column:**

- View recomputes regex per query — fine now, less fine as the corpus grows.
- Generated column keeps regex in SQL, harder to unit-test and iterate. Every
  regex tweak becomes a migration.
- Boolean column keeps regex logic in TS (testable, iterable) and gives an
  index-friendly filter for Phase 3.

## Pipeline changes

### `lib/filter/title.ts` (new)

Pure function `matchesEmRole(title: string): boolean`. No IO, no dependencies.
Easy to unit-test.

```ts
export function matchesEmRole(title: string): boolean {
  if (!title) return false;
  if (EXCLUDE_RE.test(title)) return false;
  return INCLUDE_RE.test(title);
}
```

Regex literals live in the same file, top-level `const`, one alternation each.

### `lib/pipeline/scan.ts` (modified)

At upsert-time, compute `title_matches_role` and include in the row:

```ts
const rows = jobs.map((j) => ({
  // ...existing fields...
  title_matches_role: matchesEmRole(j.title),
}));
```

No other pipeline change — same upsert, same deactivation logic.

### Backfill

One-time SQL script `supabase/migrations/20260902_02_backfill_title_matches.sql`
that recomputes the flag on all existing rows. Since the SQL side doesn't have
the TS regex, we translate the same include/exclude patterns to Postgres
`~*` operators. **The TS regex remains the source of truth** — the migration is
a one-time convergence, and every future write goes through TS.

Alternative considered: run backfill via a Node script that reads all rows,
calls `matchesEmRole`, writes back. Rejected because 14k rows × RTT to Supabase
is slow and unnecessary — one `UPDATE jobs SET title_matches_role = (...)`
runs in milliseconds.

If include/exclude patterns diverge between TS and SQL over time, we treat that
as tech debt to reconcile at the next scan (the TS version overwrites on every
upsert).

## Testing

`lib/filter/title.test.ts` (Vitest — needs to be added as devDep).

Two arrays of ≥ 10 real titles each, pulled from the current DB:

```ts
const INCLUDES = [
  "Engineering Manager, Consumer Product",
  "Senior Software Engineering Manager, Simulation Platforms ",
  "Director of Engineering, Rocket Motor Systems",
  "Director of Engineering, AI Platform",
  "Director, Engineering, Enterprise",
  "Head of Engineering",
  "VP, Engineering",
  "Machine Learning Engineering Manager",
  "Director of Security Engineering",
  "Manager, Platform Engineering",
];

const EXCLUDES = [
  "Manufacturing Engineering Manager, Roadrunner",
  "Test Engineering Manager",
  "Quality Engineering Manager",
  "Director, Enterprise Sales Engineering - US Central",
  "Director of Recruiting, Engineering & IT, Bangalore India",
  "Director of Supplier Industrialization Engineering",
  "Director, People Partners - Product, Design & Engineering",
  "Director, Legal Engineering, EMEA",
  "Senior EMC Design Engineer, Air Dominance and Strike",
  "Product Manager, Growth",
];

INCLUDES.forEach((t) => it(`includes: ${t}`, () => expect(matchesEmRole(t)).toBe(true)));
EXCLUDES.forEach((t) => it(`excludes: ${t}`, () => expect(matchesEmRole(t)).toBe(false)));
```

Add smoke test: `matchesEmRole('')` and `matchesEmRole(null as any)` return `false`.

## Rollout order

1. Add Vitest, write `title.ts` + tests. Iterate regex until all cases pass.
2. Ship the migration (schema + backfill).
3. Ship the pipeline change (`scan.ts` writes the flag).
4. Trigger a scan from prod. Confirm `select count(*) from jobs where title_matches_role and is_active` is in the 300-500 band.
5. Spot-check 20 rows on each side of the flag; iterate regex if needed.

## Non-goals

- **Location filter.** Spec §5 mentions it but current `jobs.location` is noisy
  free-text; not worth building until we have a canonical location vocabulary or
  the dashboard needs it. `remote_ok` boolean already exists for the obvious
  case.
- **Comp filter.** Deferred to Phase 3 (Claude parses comp from job description).
- **Score column.** That's Phase 3.

## Open questions

None — all edge cases surfaced during brainstorming (Manufacturing/Test/Quality
etc.) have been folded into the exclude list.
