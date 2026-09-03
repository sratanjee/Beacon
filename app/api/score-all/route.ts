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
