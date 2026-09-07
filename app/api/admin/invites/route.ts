import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/user';
import { getServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  const url = new URL(req.url);
  const method = url.searchParams.get('_method');
  if (method === 'delete') {
    const email = String(url.searchParams.get('email') ?? '').trim().toLowerCase();
    if (!email) return NextResponse.redirect(new URL('/admin/invites', req.url), 303);
    await getServiceClient().from('invited_emails').delete().eq('email', email);
    return NextResponse.redirect(new URL('/admin/invites', req.url), 303);
  }
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!email) return NextResponse.redirect(new URL('/admin/invites', req.url), 303);
  const res = await getServiceClient()
    .from('invited_emails')
    .insert({ email, invited_by: admin.id });
  if (res.error) console.warn('invite insert:', res.error.message);
  return NextResponse.redirect(new URL('/admin/invites', req.url), 303);
}
