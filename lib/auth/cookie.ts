// Web Crypto-based HMAC so this module works in both the Node.js API runtime
// and the Edge runtime (Next.js middleware runs on Edge by default and rejects
// `node:crypto` imports).

export const AUTH_COOKIE = 'beacon_auth';

const encoder = new TextEncoder();

async function hmac(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(password));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export async function signPassword(password: string): Promise<string> {
  return hmac(password);
}

export async function verifyCookie(
  cookieValue: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!cookieValue || !password) return false;
  const expected = await hmac(password);
  if (cookieValue.length !== expected.length) return false;
  // Constant-time compare in userland — no timingSafeEqual in Web Crypto
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= cookieValue.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
