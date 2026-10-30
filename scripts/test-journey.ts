// Live end-to-end check of the Phase 12a journey API. Needs `npm run dev` running.
//   npm run test:journey   -> asks for your email + password (hidden)
// Uses ONE series that has no position yet and dates in 2090, so it never touches real data.
// It refuses to run if every series already has a position. Everything it creates is
// hard-deleted at the end, even if a step fails.
import { createInterface } from 'node:readline/promises';
import { connectAsOwner } from './lib/owner-db';
import { askHidden } from './lib/prompt';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const ORIGIN = process.env.APP_ORIGIN;
const NOTE = '[TEST-JOURNEY]';
const SAT = '2090-01-07'; // a Saturday

let failed = 0;
const check = (name: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return pass;
};

class Client {
  cookie = '';
  async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ORIGIN) headers.Origin = ORIGIN;
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON: leave json null
    }
    return { status: res.status, json, res };
  }
  async login(email: string, password: string) {
    const r = await this.call('POST', '/api/auth/login', { email, password });
    const c = r.res.headers.getSetCookie().find((x) => x.startsWith('rc_session='));
    if (c) this.cookie = c.split(';')[0]!;
    return r;
  }
}

async function cleanup(seriesId: number | null) {
  if (seriesId === null) return;
  const { pool } = connectAsOwner();
  try {
    const ids = (
      await pool.query('select id from series_positions where series_id = $1 and note = $2', [
        seriesId,
        NOTE,
      ])
    ).rows.map((r) => r.id as number);
    await pool.query(
      `delete from audit_log where entity_type = 'SERIES_POSITION' and entity_id = any($1::bigint[])`,
      [ids],
    );
    await pool.query('delete from series_positions where id = any($1::bigint[])', [ids]);
    const left = await pool.query('select count(*)::int n from series_positions where note = $1', [
      NOTE,
    ]);
    check('cleanup: test positions and their audit rows hard-deleted', left.rows[0].n === 0);
  } finally {
    await pool.end();
  }
}

async function main() {
  if (!ORIGIN) throw new Error('APP_ORIGIN is not set in .env.local');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = (await rl.question('Email: ')).trim();
  rl.close();
  const password = await askHidden('Password: ');
  console.log(`\nTesting ${BASE} (Origin: ${ORIGIN})\n`);

  const me = new Client();
  const login = await me.login(email, password);
  if (!check('0. log in as you', login.status === 200, `status ${login.status}`)) process.exit(1);

  let seriesId: number | null = null;
  try {
    const board = await fetch(`${BASE}/api/status?t=${Date.now()}`);
    const status = (await board.json()) as {
      series: { seriesId: number; series: string; state: { status: string } }[];
    };
    const free = status.series.find((s) => s.state.status === 'NONE');
    if (!check('1. public status matrix lists every series', status.series.length > 0)) return;
    if (!free) throw new Error('Every series already has a position; nothing safe to test with.');
    seriesId = free.seriesId;
    console.log(`Using ${free.series} (#${seriesId}) with dates in 2090\n`);

    const tasks = await me.call('GET', '/api/admin/tasks');
    check(
      '2. tasks list is admin-only data and includes NEW_BATCH for series without a position',
      tasks.status === 200 &&
        tasks.json.tasks.some((t: { type: string }) => t.type === 'NEW_BATCH'),
      `status ${tasks.status}`,
    );
    const anon = await fetch(`${BASE}/api/admin/tasks`);
    check('3. tasks without a session -> 401', anon.status === 401, `status ${anon.status}`);

    const bad = await me.call('POST', '/api/admin/positions/bulk', {
      seriesIds: [seriesId],
      kind: 'POSITION',
      asOfDate: SAT,
      semesterNo: 3,
      phase: 'EXAM',
      weekNo: 9,
      note: NOTE,
    });
    check('4. EXAM week 9 does not exist -> 422', bad.status === 422, `status ${bad.status}`);

    const start = await me.call('POST', '/api/admin/positions/bulk', {
      seriesIds: [seriesId],
      kind: 'SEMESTER_START',
      asOfDate: '2090-01-10', // a Wednesday: normalised to Sat 7 Jan
      semesterNo: 3,
      note: NOTE,
    });
    check('5. SEMESTER_START saved (201)', start.status === 201, `status ${start.status}`);

    const j1 = await fetch(`${BASE}/api/series/${seriesId}/journey?date=${SAT}&t=${Date.now()}`);
    const journey = await j1.json();
    check(
      '6. journey starts that Saturday as 2-1 class week 1, confirmed',
      journey.weeks[0]?.weekStart === SAT &&
        journey.state.semesterLabel === '2-1' &&
        journey.state.phase === 'CLASS' &&
        journey.state.weekNo === 1 &&
        journey.state.confirmed === true,
      JSON.stringify(journey.state).slice(0, 120),
    );
    check('7. journey reaches graduation', typeof journey.graduation === 'string');

    const replace = await me.call('POST', '/api/admin/positions/bulk', {
      seriesIds: [seriesId],
      kind: 'POSITION',
      asOfDate: SAT,
      semesterNo: 3,
      phase: 'CLASS',
      weekNo: 5,
      note: NOTE,
    });
    check('8. same week again replaces the old position', replace.status === 201);
    const j2 = await (
      await fetch(`${BASE}/api/series/${seriesId}/journey?date=${SAT}&t=${Date.now()}`)
    ).json();
    check(
      '9. only one live position that week, now class week 5',
      j2.positions.length === 1 && j2.state.weekNo === 5,
    );

    const del = await me.call('DELETE', `/api/admin/positions/${j2.positions[0].id}`);
    check('10. position deleted (soft)', del.status === 200, `status ${del.status}`);
    const again = await me.call('DELETE', `/api/admin/positions/${j2.positions[0].id}`);
    check('11. deleting it twice -> 404', again.status === 404, `status ${again.status}`);

    const settings = await me.call('GET', '/api/admin/academic-settings');
    check(
      '12. settings: default structure has 6 blocks',
      settings.status === 200 && settings.json.structure.length === 6,
    );
    const impact = await me.call('POST', '/api/admin/impact', {
      add: [{ startDate: SAT, endDate: SAT, audience: [{ scopeType: 'ALL', scopeId: null }] }],
    });
    check(
      '13. impact answers with groups',
      impact.status === 200 && Array.isArray(impact.json.groups),
    );

    const { pool } = connectAsOwner();
    try {
      const rows = await pool.query(
        `select action, count(*)::int n from audit_log
          where entity_type = 'SERIES_POSITION'
            and entity_id in (select id from series_positions where series_id = $1 and note = $2)
          group by 1`,
        [seriesId, NOTE],
      );
      const kinds = new Set(rows.rows.map((r) => r.action as string));
      check(
        '14. audit_log has CREATE, UPDATE (replace) and DELETE entries',
        ['CREATE', 'UPDATE', 'DELETE'].every((k) => kinds.has(k)),
        [...kinds].join(', '),
      );
    } finally {
      await pool.end();
    }
  } finally {
    await cleanup(seriesId);
    await me.call('POST', '/api/auth/logout');
  }
}

main()
  .then(() => {
    console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      /fetch failed|ECONNREFUSED/i.test(msg)
        ? `Cannot reach ${BASE}. Is \`npm run dev\` running?`
        : msg,
    );
    process.exit(1);
  });
