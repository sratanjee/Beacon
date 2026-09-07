// One-off smoke test — renders sample resume + cover letter PDFs.
// Run: cd /Users/sratanjee/Beacon && npx tsx scripts/pdf-smoke.mjs
// Outputs to /tmp/beacon-smoke-*.pdf so you can visually inspect.
//
// Shim: the target module imports 'server-only' which is designed to throw
// outside Next's RSC pipeline. We register a Node loader hook via require.cache
// so the import becomes a no-op for this script only.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve('server-only');
require.cache[serverOnlyPath] = { id: serverOnlyPath, filename: serverOnlyPath, loaded: true, exports: {} };

const { markdownToPdfBuffer } = await import('../lib/pdf/from-markdown.tsx');
const { writeFileSync } = await import('node:fs');

const resumeMd = `# Sarang Ratanjee
sratanjee@gmail.com · +1 (555) 555-5555 · linkedin.com/in/sratanjee

## Summary
Engineering leader with 10+ years shipping developer platforms, AI systems, and consumer software. Recently focused on **AI-augmented coaching infrastructure** and multi-persona conversational systems.

## Experience

### Axon Enterprise
**Engineering Manager, Fleet 3 Platform** · 2023 – Present
- Led 8-engineer team shipping Fleet 3 device management platform serving 20K+ public safety agencies
- Cut sync latency 40% via streaming architecture rewrite
- Owned KTLO for a 200-service backend during transition to microservices

### Prior Role
**Senior Software Engineer** · 2019 – 2023
- Built distributed ingestion pipeline handling 2B+ events/day
- Migrated legacy monolith to k8s with zero downtime

## Education
**BS Computer Science** · University of Somewhere · 2015

## Skills
TypeScript · Python · Next.js · Supabase · PostgreSQL · Flutter · LLMs (Claude, GPT) · RAG · Prompt engineering · System design
`;

const coverMd = `# Sarang Ratanjee
sratanjee@gmail.com · +1 (555) 555-5555 · linkedin.com/in/sratanjee

Dear Hiring Team,

Writing about the **Staff Engineer, AI Platform** role at Acme. The team's focus on shipping coach-facing tools that scale personalization without flattening the coach's voice — that's exactly the problem space I've been building in.

At Axon, I shipped the Fleet 3 Platform infrastructure serving 20K+ agencies with **99.98% uptime**, then led the AI-augmentation layer that cut incident triage time by 60%. Beyond that, I co-founded a boutique coaching platform (Coach OS) where the memory-per-client + multi-persona architecture is the moat — the exact shape Acme's job posting describes.

I'd like to talk about how the tradeoffs I made at Axon between latency, cost, and personalization would map onto the challenges you called out in the posting.

Best,
Sarang Ratanjee
`;

console.log('Rendering resume PDF...');
const resumeBuffer = await markdownToPdfBuffer(resumeMd, 'tailored_resume');
writeFileSync('/tmp/beacon-smoke-resume.pdf', resumeBuffer);
console.log(`  ✓ resume: ${resumeBuffer.length} bytes → /tmp/beacon-smoke-resume.pdf`);

console.log('Rendering cover letter PDF...');
const coverBuffer = await markdownToPdfBuffer(coverMd, 'cover_letter');
writeFileSync('/tmp/beacon-smoke-cover.pdf', coverBuffer);
console.log(`  ✓ cover:  ${coverBuffer.length} bytes → /tmp/beacon-smoke-cover.pdf`);
