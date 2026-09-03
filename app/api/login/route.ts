import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, signPassword } from '@/lib/auth/cookie';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '/dashboard');

  const site = process.env.SITE_PASSWORD;
  if (!site) {
    return NextResponse.json({ error: 'SITE_PASSWORD not configured' }, { status: 500 });
  }
  if (password !== site) {
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(next)}`, req.url));
  }

  // Only allow same-origin redirects
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  const res = NextResponse.redirect(new URL(safeNext, req.url));
  res.cookies.set(AUTH_COOKIE, await signPassword(site), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
