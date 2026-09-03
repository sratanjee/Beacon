import { createHmac, timingSafeEqual } from 'node:crypto';

export const AUTH_COOKIE = 'beacon_auth';

// The cookie value is HMAC-SHA256(password, password) — using the password as
// both the key and the message. This gives us a deterministic 64-hex string
// per password without a separate secret to manage. Rotation = change
// SITE_PASSWORD, invalidates all cookies.
export function signPassword(password: string): string {
  return createHmac('sha256', password).update(password).digest('hex');
}

export function verifyCookie(
  cookieValue: string | null | undefined,
  password: string,
): boolean {
  if (!cookieValue || !password) return false;
  const expected = signPassword(password);
  if (cookieValue.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(expected));
  } catch {
    return false;
  }
}
