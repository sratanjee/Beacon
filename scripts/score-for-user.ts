// Trigger the standard scoring pipeline for a specific user by UUID.
// Reuses lib/scoring/run.ts — same prompt, same DB writes as the weekly scan.
// Run: npx tsx --env-file=.env.local scripts/score-for-user.ts <user-uuid>

// lib/scoring/run.ts imports 'server-only' which throws outside Next's RSC
// runtime. Shim it as a no-op via require.cache before loading.
import { createRequire } from 'node:module';
const requireShim = createRequire(import.meta.url);
const serverOnlyPath = requireShim.resolve('server-only');
requireShim.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  // @ts-expect-error minimal cache entry shape
  paths: [],
  children: [],
};

async function main() {
  const uid = process.argv[2];
  if (!uid) {
    console.error('usage: score-for-user.ts <user-uuid>');
    process.exit(1);
  }
  const { runScoring } = await import('../lib/scoring/run');
  const result = await runScoring({ userId: uid });
  console.log('Result:', result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
