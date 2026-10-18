import { describe, expect, test } from 'vitest';
import { clearedSessionCookie, readCookie, sessionCookie } from '@/core/auth/cookie';
import { checkMutation } from '@/core/auth/origin';
import { generateToken, hashToken } from '@/core/auth/token';

describe('token', () => {
  test('generateToken is 32 random bytes as base64url, unique each time', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes -> 43 chars, no padding
    expect(generateToken()).not.toBe(a);
  });

  test('hashToken is deterministic sha256 hex and differs from the token', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abd')).not.toBe(hashToken('abc'));
  });
});

describe('checkMutation', () => {
  const app = 'http://localhost:3000';
  const json = 'application/json';
  const cases: [string, string | null, string | null, string | undefined, number | 'ok'][] = [
    ['matching origin + json', app, json, app, 'ok'],
    ['json with charset', app, 'application/json; charset=utf-8', app, 'ok'],
    ['content type is case-insensitive', app, 'Application/JSON', app, 'ok'],
    ['APP_ORIGIN with trailing slash', app, json, `${app}/`, 'ok'],
    ['APP_ORIGIN with different case', app, json, 'HTTP://LOCALHOST:3000', 'ok'],
    ['missing origin', null, json, app, 403],
    ['"null" origin', 'null', json, app, 403],
    ['other origin', 'https://evil.example', json, app, 403],
    ['same host, different port', 'http://localhost:3001', json, app, 403],
    ['same host, http vs https', 'https://localhost:3000', json, app, 403],
    ['origin with trailing path', `${app}/`, json, app, 403],
    ['wrong content type', app, 'text/plain', app, 415],
    ['form content type', app, 'application/x-www-form-urlencoded', app, 415],
    ['missing content type', app, null, app, 415],
    ['APP_ORIGIN unset', app, json, undefined, 500],
    ['APP_ORIGIN garbage', app, json, 'not a url', 500],
  ];
  test.each(cases)('%s', (_n, origin, contentType, appOrigin, expected) => {
    const r = checkMutation({ origin, contentType, appOrigin });
    if (expected === 'ok') expect(r).toEqual({ ok: true });
    else expect(r).toMatchObject({ ok: false, status: expected });
  });
});

describe('cookie', () => {
  test('session cookie has the required attributes (dev: no Secure)', () => {
    expect(sessionCookie('tok', false)).toBe(
      'rc_session=tok; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800',
    );
  });

  test('session cookie adds Secure in production', () => {
    expect(sessionCookie('tok', true)).toBe(
      'rc_session=tok; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800',
    );
  });

  test('cleared cookie expires immediately', () => {
    expect(clearedSessionCookie(true)).toBe(
      'rc_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    );
  });

  test.each([
    ['single', 'rc_session=abc', 'abc'],
    ['among others', 'a=1; rc_session=abc; b=2', 'abc'],
    ['extra spaces', '  rc_session = abc ', 'abc'],
    ['missing', 'a=1; b=2', null],
    ['null header', null, null],
    ['empty value', 'rc_session=', null],
    ['name must match exactly', 'x_rc_session=abc', null],
    ['no equals sign', 'rc_session', null],
  ])('readCookie: %s', (_n, header, expected) => {
    expect(readCookie(header, 'rc_session')).toBe(expected);
  });
});
