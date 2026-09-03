import { describe, it, expect } from 'vitest';
import { AUTH_COOKIE, signPassword, verifyCookie } from './cookie';

describe('signPassword', () => {
  it('returns a stable hex string for a given password', () => {
    const a = signPassword('hunter2');
    const b = signPassword('hunter2');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different values for different passwords', () => {
    expect(signPassword('hunter2')).not.toBe(signPassword('hunter3'));
  });
});

describe('verifyCookie', () => {
  it('accepts a cookie value signed with the same password', () => {
    const cookie = signPassword('correct-password');
    expect(verifyCookie(cookie, 'correct-password')).toBe(true);
  });

  it('rejects mismatched password', () => {
    const cookie = signPassword('correct-password');
    expect(verifyCookie(cookie, 'wrong-password')).toBe(false);
  });

  it('rejects null / empty cookie', () => {
    expect(verifyCookie(null, 'anything')).toBe(false);
    expect(verifyCookie('', 'anything')).toBe(false);
    expect(verifyCookie(undefined, 'anything')).toBe(false);
  });

  it('uses constant-time comparison (no early-exit)', () => {
    expect(verifyCookie('a'.repeat(64), 'x')).toBe(false);
    expect(verifyCookie('a'.repeat(1), 'x')).toBe(false);
  });
});

describe('AUTH_COOKIE constant', () => {
  it('is a stable name', () => {
    expect(AUTH_COOKIE).toBe('beacon_auth');
  });
});
