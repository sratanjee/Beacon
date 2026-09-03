import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyCookie } from '@/lib/auth/cookie';

// Public routes — always accessible without a cookie
const PUBLIC_PATHS = new Set(['/login']);
const PUBLIC_PATH_PREFIXES = ['/api/login', '/api/run-weekly-scan'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const site = process.env.SITE_PASSWORD;
  if (!site) {
    // Fail closed if not configured — better than accidentally leaking during setup
    return NextResponse.redirect(new URL('/login?error=1', req.url));
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (verifyCookie(cookie, site)) return NextResponse.next();

  const next = pathname + req.nextUrl.search;
  return NextResponse.redirect(
    new URL(`/login?next=${encodeURIComponent(next)}`, req.url),
  );
}

export const config = {
  // Run on everything except Next.js internals, static files, favicon.
  matcher: ['/((?!_next/|favicon\\.ico|.*\\..*).*)'],
};
