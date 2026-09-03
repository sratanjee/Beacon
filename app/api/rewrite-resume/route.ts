import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/server';
import { rewriteResumeForPositioning } from '@/lib/generate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: NextRequest) {
  const db = getServiceClient();
  const profileRes = await db
    .from('profiles')
    .select('resume_text, positioning')
    .eq('id', 1)
    .maybeSingle();
  const resumeText = profileRes.data?.resume_text?.trim();
  const positioning = profileRes.data?.positioning?.trim();
  if (!resumeText) return NextResponse.json({ error: 'no resume uploaded' }, { status: 400 });
  if (!positioning) return NextResponse.json({ error: 'set positioning first' }, { status: 400 });

  try {
    const result = await rewriteResumeForPositioning({ resumeText, positioning });
    return NextResponse.json({
      text: result.text,
      model: result.model,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
