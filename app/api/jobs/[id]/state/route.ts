import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Existing = { is_saved: boolean; applied_at: string | null } | null;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const jobId = Number.parseInt(id, 10);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: 'invalid job id' }, { status: 400 });
  }

  const form = await req.formData();
  const action = String(form.get('action') ?? '');
  const returnTo = String(form.get('return_to') ?? '/dashboard');
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard';

  const db = getServiceClient();
  const existingRes = await db
    .from('job_states')
    .select('is_saved, applied_at')
    .eq('job_id', jobId)
    .maybeSingle();
  const existing: Existing = existingRes.data ?? null;

  const now = new Date().toISOString();
  const update: { job_id: number; is_saved: boolean; applied_at: string | null; updated_at: string } = {
    job_id: jobId,
    is_saved: existing?.is_saved ?? false,
    applied_at: existing?.applied_at ?? null,
    updated_at: now,
  };

  if (action === 'toggle_save') update.is_saved = !update.is_saved;
  else if (action === 'mark_applied') update.applied_at = update.applied_at ?? now;
  else if (action === 'unmark_applied') update.applied_at = null;
  else return NextResponse.json({ error: 'unknown action' }, { status: 400 });

  const upsert = await db.from('job_states').upsert(update);
  if (upsert.error) {
    return NextResponse.json({ error: upsert.error.message }, { status: 500 });
  }

  return NextResponse.redirect(new URL(safeReturn, req.url), 303);
}
