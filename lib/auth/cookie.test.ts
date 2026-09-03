import { describe, it, expect } from 'vitest';
import { AUTH_COOKIE, signPassword, verifyCookie } from './cookie';

describe('signPassword', () => {
  it('returns a stable hex string for a given password', async () => {
    const a = await signPassword('hunter2');
    const b = await signPassword('hunter2');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different values for different passwords', async () => {
    const [a, b] = await Promise.all([signPassword('hunter2'), signPassword('hunter3')]);
    expect(a).not.toBe(b);
  });
});

describe('verifyCookie', () => {
  it('accepts a cookie value signed with the same password', async () => {
    const cookie = await signPassword('correct-password');
    expect(await verifyCookie(cookie, 'correct-password')).toBe(true);
  });

  it('rejects mismatched password', async () => {
    const cookie = await signPassword('correct-password');
    expect(await verifyCookie(cookie, 'wrong-password')).toBe(false);
  });

  it('rejects null / empty cookie', async () => {
    expect(await verifyCookie(null, 'anything')).toBe(false);
    expect(await verifyCookie('', 'anything')).toBe(false);
    expect(await verifyCookie(undefined, 'anything')).toBe(false);
  });

  it('uses constant-time comparison (no early-exit)', async () => {
    expect(await verifyCookie('a'.repeat(64), 'x')).toBe(false);
    expect(await verifyCookie('a'.repeat(1), 'x')).toBe(false);
  });
});

describe('AUTH_COOKIE constant', () => {
  it('is a stable name', () => {
    expect(AUTH_COOKIE).toBe('beacon_auth');
  });
});
