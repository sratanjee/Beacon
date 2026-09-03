import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/server';
import { generateCompanySummary } from '@/lib/generate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const companyId = Number.parseInt(id, 10);
  if (!Number.isFinite(companyId)) {
    return NextResponse.json({ error: 'invalid company id' }, { status: 400 });
  }

  const force = new URL(req.url).searchParams.get('force') === '1';
  const db = getServiceClient();

  const companyRes = await db
    .from('companies')
    .select('id, name, summary, summary_generated_at')
    .eq('id', companyId)
    .maybeSingle();
  if (companyRes.error || !companyRes.data) {
    return NextResponse.json({ error: 'company not found' }, { status: 404 });
  }

  if (!force && companyRes.data.summary) {
    return NextResponse.json({
      summary: companyRes.data.summary,
      generated_at: companyRes.data.summary_generated_at,
      cached: true,
    });
  }

  let result;
  try {
    result = await generateCompanySummary(companyRes.data.name);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();
  const upsert = await db
    .from('companies')
    .update({ summary: result.text, summary_generated_at: now })
    .eq('id', companyId);
  if (upsert.error) {
    return NextResponse.json(
      { error: `save failed: ${upsert.error.message}`, summary: result.text },
      { status: 500 },
    );
  }

  return NextResponse.json({
    summary: result.text,
    generated_at: now,
    cached: false,
  });
}
