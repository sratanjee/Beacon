import { NextRequest, NextResponse } from 'next/server';
import { extractResumeText } from '@/lib/pdf/extract';
import { getServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no file field' }, { status: 400 });
  }
  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'only application/pdf accepted' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file exceeds 5MB' }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const db = getServiceClient();

  const path = `resume-${Date.now()}.pdf`;
  const uploadRes = await db.storage.from('resumes').upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (uploadRes.error) {
    return NextResponse.json({ error: `storage: ${uploadRes.error.message}` }, { status: 500 });
  }

  let extracted;
  try {
    extracted = await extractResumeText(bytes);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const upsertRes = await db
    .from('profiles')
    .upsert({
      id: 1,
      resume_pdf_path: path,
      resume_text: extracted.text,
      updated_at: new Date().toISOString(),
    })
    .select('id, updated_at')
    .single();

  if (upsertRes.error) {
    return NextResponse.json({ error: `db: ${upsertRes.error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    text_length: extracted.text.length,
    input_tokens: extracted.input_tokens,
    updated_at: upsertRes.data.updated_at,
  });
}
