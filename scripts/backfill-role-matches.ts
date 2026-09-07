// Backfill job_role_matches for every active job across all 6 role packs.
// Idempotent (uses on conflict do nothing).
// Run: pnpm exec tsx scripts/backfill-role-matches.ts

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { ROLE_PACKS, matchesPack } from '../lib/roles/packs';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  console.log('Loading active jobs...');
  let jobs: Array<{ id: number; title: string }> = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data: batch, error } = await db
      .from('jobs')
      .select('id, title')
      .eq('is_active', true)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!batch || batch.length === 0) break;
    jobs = jobs.concat(batch);
    console.log(`  Loaded ${jobs.length} jobs so far...`);
    offset += pageSize;
  }
  console.log(`Loaded ${jobs.length} active jobs total`);

  const rows: { job_id: number; role_pack: string }[] = [];
  for (const j of jobs) {
    for (const p of ROLE_PACKS) {
      if (matchesPack(p.id, j.title)) rows.push({ job_id: j.id, role_pack: p.id });
    }
  }
  console.log(`Computed ${rows.length} match rows across ${ROLE_PACKS.length} packs`);

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error: err } = await db
      .from('job_role_matches')
      .upsert(batch, { onConflict: 'job_id,role_pack', ignoreDuplicates: true });
    if (err) throw err;
    console.log(`  ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }

  const counts: Record<string, number | null> = {};
  for (const p of ROLE_PACKS) {
    const { count } = await db
      .from('job_role_matches')
      .select('*', { count: 'exact', head: true })
      .eq('role_pack', p.id);
    counts[p.id] = count;
  }
  console.log('Match counts per pack:', counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
