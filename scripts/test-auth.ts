// Live end-to-end check of the auth endpoints. Needs `npm run dev` running.
//   npm run test:auth                 -> asks for email + password (hidden)
//   npm run test:auth -- --real-email -> rate-limit step uses YOUR email (locks it ~15 min)
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { askHidden } from './lib/prompt';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const ORIGIN = process.env.APP_ORIGIN;
const useRealEmail = process.argv.includes('--real-email');

let failed = 0;
function report(name: string, pass: boolean, detail = '') {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

interface Opts {
  origin?: string | null;
  cookie?: string;
  ip?: string;
}

async function post(path: string, body: unknown, o: Opts = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const origin = o.origin === undefined ? ORIGIN : o.origin;
  if (origin) headers.Origin = origin;
  if (o.cookie) headers.Cookie = o.cookie;
  // Local dev has no proxy, so we can play the proxy to simulate different clients.
  if (o.ip) headers['x-vercel-forwarded-for'] = o.ip;
  return fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
}

const get = (path: string, cookie?: string) =>
  fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {} });

async function main() {
  if (!ORIGIN) throw new Error('APP_ORIGIN is not set in .env.local');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = (await rl.question('Email: ')).trim();
  rl.close();
  const password = await askHidden('Password: ');
  console.log(`\nTesting ${BASE} (Origin: ${ORIGIN})\n`);

  // 1. login
  const login = await post('/api/auth/login', { email, password });
  const setCookie = login.headers.getSetCookie().find((c) => c.startsWith('rc_session=')) ?? '';
  const cookie = setCookie.split(';')[0] ?? '';
  report('1. login succeeds (200)', login.status === 200, `status ${login.status}`);
  report(
    '   session cookie is HttpOnly + SameSite=Lax',
    /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie),
  );
  if (login.status !== 200) {
    console.log('\nCannot continue without a login. Check the email/password and the server.');
    process.exit(1);
  }

  // 2. /me while logged in
  const me = await get('/api/auth/me', cookie);
  const meBody = (await me.json()) as { admin?: { email?: string } };
  report(
    '2. /me returns your admin (200)',
    me.status === 200 && meBody.admin?.email === email.trim().toLowerCase(),
    `status ${me.status}`,
  );

  // 3. logout
  const logout = await post('/api/auth/logout', {}, { cookie });
  report('3. logout succeeds (200)', logout.status === 200, `status ${logout.status}`);

  // 4. /me with the old cookie must fail now
  const meAfter = await get('/api/auth/me', cookie);
  report(
    '4. /me after logout is rejected (401)',
    meAfter.status === 401,
    `status ${meAfter.status}`,
  );

  // 5. foreign Origin
  const evil = await post(
    '/api/auth/login',
    { email, password },
    { origin: 'https://evil.example' },
  );
  report(
    '5. login from a foreign Origin is rejected (403, no cookie)',
    evil.status === 403 && evil.headers.getSetCookie().length === 0,
    `status ${evil.status}`,
  );

  // 6. per email+IP limit: 5 wrong attempts are 401, the 6th is 429
  const probe = () => `probe-${randomBytes(6).toString('hex')}@example.invalid`;
  const target = useRealEmail ? email : probe();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    statuses.push(
      (
        await post(
          '/api/auth/login',
          { email: target, password: 'wrong-password-123' },
          { ip: '203.0.113.1' },
        )
      ).status,
    );
  }
  report(
    `6. email+IP limit: 5 wrong passwords -> 401, 6th -> 429${useRealEmail ? ' (your real email!)' : ''}`,
    statuses.slice(0, 5).every((s) => s === 401) && statuses[5] === 429,
    statuses.join(','),
  );

  // 7. per-email cap: 20 failures from 20 different IPs, then the 21st IP is blocked
  const capEmail = probe();
  const capStatuses: number[] = [];
  for (let i = 0; i < 21; i++) {
    const r = await post(
      '/api/auth/login',
      { email: capEmail, password: 'wrong-password-123' },
      { ip: `203.0.113.${10 + i}` },
    );
    capStatuses.push(r.status);
  }
  report(
    '7. per-email cap: 20 failures from different IPs -> 401, 21st -> 429',
    capStatuses.slice(0, 20).every((s) => s === 401) && capStatuses[20] === 429,
    `${capStatuses.filter((s) => s === 401).length}x401, last ${capStatuses[20]}`,
  );

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(
    /fetch failed|ECONNREFUSED/i.test(msg)
      ? `Cannot reach ${BASE}. Is \`npm run dev\` running?`
      : msg,
  );
  process.exit(1);
});
