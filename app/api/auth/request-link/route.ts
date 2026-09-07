import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getServiceClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.redirect(new URL('/login?error=1', req.url), 303);
  }

  // Allowlist check first — no leak of "email known" vs "not allowed."
  const admin = getServiceClient();
  const { data: invite } = await admin
    .from('invited_emails')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  if (!invite) {
    // Reuse the same message regardless of the reason.
    return NextResponse.redirect(new URL('/login?sent=1', req.url), 303);
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
  const origin = req.headers.get('origin') ?? new URL(req.url).origin;
  await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/api/auth/callback`,
    },
  });

  return NextResponse.redirect(new URL('/login?sent=1', req.url), 303);
}
