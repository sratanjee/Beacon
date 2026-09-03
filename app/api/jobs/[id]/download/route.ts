import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/server';
import { markdownToDocxBuffer } from '@/lib/docx/from-markdown';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Kind = 'cover_letter' | 'tailored_resume';

const KIND_LABEL: Record<Kind, string> = {
  cover_letter: 'Cover-Letter',
  tailored_resume: 'Resume',
};

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '-').slice(0, 60) || 'Beacon';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const jobId = Number.parseInt(id, 10);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: 'invalid job id' }, { status: 400 });
  }
  const kind = new URL(req.url).searchParams.get('kind') as Kind | null;
  if (kind !== 'cover_letter' && kind !== 'tailored_resume') {
    return NextResponse.json(
      { error: 'kind must be cover_letter or tailored_resume' },
      { status: 400 },
    );
  }

  const db = getServiceClient();

  const [docRes, jobRes] = await Promise.all([
    db
      .from('generated_docs')
      .select('text')
      .eq('job_id', jobId)
      .eq('kind', kind)
      .maybeSingle(),
    db
      .from('jobs')
      .select('id, companies!inner(name)')
      .eq('id', jobId)
      .maybeSingle(),
  ]);

  if (!docRes.data) {
    return NextResponse.json(
      { error: `no ${kind} generated yet — click generate first` },
      { status: 404 },
    );
  }
  const companyName = (jobRes.data as { companies: { name: string } } | null)?.companies?.name ?? 'Company';

  const buffer = await markdownToDocxBuffer(docRes.data.text);
  const filename = `${sanitize(companyName)}-${KIND_LABEL[kind]}.docx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
