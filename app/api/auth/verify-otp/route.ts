import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Sidesteps Supabase's redirect_to allow-list: friend types their email + the
// 6-digit code Sarang DM'd them, we call verifyOtp server-side, session cookie
// gets set on mybeacon.sh, done. No SMTP, no redirect_to gymnastics.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const token = String(form.get('token') ?? '').trim();

  if (!email.includes('@')) {
    return NextResponse.redirect(new URL('/login/verify?error=email', req.url), 303);
  }
  if (!/^\d{6,8}$/.test(token)) {
    return NextResponse.redirect(
      new URL(`/login/verify?error=token&email=${encodeURIComponent(email)}`, req.url),
      303,
    );
  }

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

  // Supabase's verifyOtp type depends on how the OTP was generated:
  // - signInWithOtp email flow → 'email'
  // - admin.generateLink({type:'magiclink'}) → 'magiclink' (via email_otp)
  // Try both; whichever matches wins.
  const attempts = [
    { type: 'email' as const },
    { type: 'magiclink' as const },
  ];
  let data: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>['data'] | null = null;
  let lastError: string | null = null;
  for (const attempt of attempts) {
    const res = await supabase.auth.verifyOtp({ email, token, type: attempt.type });
    if (!res.error && res.data.user) {
      data = res.data;
      break;
    }
    lastError = res.error?.message ?? 'unknown';
  }
  if (!data?.user) {
    console.error('[verify-otp] all types failed', { email, lastError });
    return NextResponse.redirect(
      new URL(`/login/verify?error=verify&email=${encodeURIComponent(email)}`, req.url),
      303,
    );
  }

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
    return NextResponse.redirect(new URL('/onboarding', req.url), 303);
  }
  if (!existing.role_pack) {
    return NextResponse.redirect(new URL('/onboarding', req.url), 303);
  }
  return NextResponse.redirect(new URL('/dashboard', req.url), 303);
}
