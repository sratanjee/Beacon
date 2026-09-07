import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/login?error=1', req.url));

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        },
      },
    },
  );
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL('/login?error=1', req.url));

  // Ensure a users row exists (first-time login).
  const admin = getServiceClient();
  const { data: existing } = await admin
    .from('users')
    .select('id, role_pack')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!existing) {
    await admin.from('users').insert({
      id: data.user.id,
      email: data.user.email!,
      display_name: null,
      role: 'user',
      role_pack: null,
    });
    return NextResponse.redirect(new URL('/onboarding', req.url));
  }
  if (!existing.role_pack) {
    return NextResponse.redirect(new URL('/onboarding', req.url));
  }
  return NextResponse.redirect(new URL('/dashboard', req.url));
}
