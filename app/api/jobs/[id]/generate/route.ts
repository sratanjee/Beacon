import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/server';
import { generateCoverLetter, generateTailoredResume, type JobContext } from '@/lib/generate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Kind = 'cover_letter' | 'tailored_resume';

type JobRow = {
  id: number;
  title: string;
  location: string | null;
  description_text: string | null;
  companies: { name: string } | null;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const jobId = Number.parseInt(id, 10);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: 'invalid job id' }, { status: 400 });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') as Kind | null;
  if (kind !== 'cover_letter' && kind !== 'tailored_resume') {
    return NextResponse.json(
      { error: 'kind must be cover_letter or tailored_resume' },
      { status: 400 },
    );
  }

  const force = url.searchParams.get('force') === '1';
  const db = getServiceClient();

  if (!force) {
    const cached = await db
      .from('generated_docs')
      .select('text, generated_at, model')
      .eq('job_id', jobId)
      .eq('kind', kind)
      .maybeSingle();
    if (cached.data) {
      return NextResponse.json({
        text: cached.data.text,
        generated_at: cached.data.generated_at,
        model: cached.data.model,
        cached: true,
      });
    }
  }

  const jobRes = await db
    .from('jobs')
    .select('id, title, location, description_text, companies!inner(name)')
    .eq('id', jobId)
    .maybeSingle();
  if (jobRes.error || !jobRes.data) {
    return NextResponse.json({ error: 'job not found' }, { status: 404 });
  }
  const job = jobRes.data as unknown as JobRow;

  const profileRes = await db
    .from('profiles')
    .select('resume_text')
    .eq('id', 1)
    .maybeSingle();
  const resumeText = profileRes.data?.resume_text?.trim();
  if (!resumeText) {
    return NextResponse.json(
      { error: 'no resume uploaded — visit /resume first' },
      { status: 400 },
    );
  }

  const ctx: JobContext = {
    title: job.title,
    company: job.companies?.name ?? 'unknown',
    location: job.location,
    description_text: job.description_text,
  };

  let result;
  try {
    result =
      kind === 'cover_letter'
        ? await generateCoverLetter(ctx, resumeText)
        : await generateTailoredResume(ctx, resumeText);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const upsert = await db
    .from('generated_docs')
    .upsert({
      job_id: jobId,
      kind,
      text: result.text,
      model: result.model,
      tokens_in: result.input_tokens,
      tokens_out: result.output_tokens,
      generated_at: new Date().toISOString(),
    })
    .select('generated_at')
    .single();
  if (upsert.error) {
    return NextResponse.json(
      { error: `save failed: ${upsert.error.message}`, text: result.text },
      { status: 500 },
    );
  }

  return NextResponse.json({
    text: result.text,
    generated_at: upsert.data.generated_at,
    model: result.model,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    cached: false,
  });
}
