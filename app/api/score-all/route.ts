import { NextRequest, NextResponse } from 'next/server';
import { runScoring } from '@/lib/scoring/run';
import { requireUser } from '@/lib/auth/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  await requireUser();
  const force = new URL(req.url).searchParams.get('force') === '1';
  try {
    // TODO(T10): pass user.id for per-user scoring
    const summary = await runScoring({ force });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
