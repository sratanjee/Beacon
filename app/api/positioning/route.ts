import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const form = await req.formData();
  const positioning = String(form.get('positioning') ?? '').trim();
  const returnTo = String(form.get('return_to') ?? '/resume');
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/resume';

  const db = getServiceClient();
  const upsert = await db
    .from('users')
    .update({
      positioning: positioning || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);
  if (upsert.error) {
    return NextResponse.json({ error: upsert.error.message }, { status: 500 });
  }

  return NextResponse.redirect(new URL(safeReturn, req.url), 303);
}
