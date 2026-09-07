import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/user';
import { ROLE_PACKS } from '@/lib/roles/packs';
import { getServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const form = await req.formData();
  const rolePack = String(form.get('role_pack') ?? '');
  const valid = ROLE_PACKS.some((p) => p.id === rolePack);
  if (!valid) return NextResponse.redirect(new URL('/onboarding', req.url), 303);

  const db = getServiceClient();
  const { error } = await db
    .from('users')
    .update({ role_pack: rolePack, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.redirect(new URL('/onboarding', req.url), 303);
}
