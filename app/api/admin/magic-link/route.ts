import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/user';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin-only: generate a magic-link URL for an invited email without sending
// an SMTP email. Supabase's built-in SMTP is unreliable + rate-limited, so
// this bypass lets Sarang generate a link and DM it out-of-band.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }

  const admin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const origin = req.headers.get('origin') ?? new URL(req.url).origin;
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: `${origin}/api/auth/callback`,
    },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const otp = data.properties?.email_otp;
  const verifyUrl = otp
    ? `${origin}/login/verify?email=${encodeURIComponent(email)}`
    : null;

  return NextResponse.json({
    email,
    otp,
    verify_url: verifyUrl,
    action_link: data.properties?.action_link,
    hint:
      'Preferred: DM the friend the verify_url + otp — bypasses Supabase redirect-allowlist quirks. ' +
      'The action_link only works if the callback URL is in Supabase Auth allowlist.',
  });
}
