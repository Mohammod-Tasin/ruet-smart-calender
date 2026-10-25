// Live end-to-end check of the admin holiday API. Needs `npm run dev` running.
//   npm run test:holidays   -> asks for your email + password (hidden)
// Uses a 2-week window far in the future that has no holidays at all (one-off or yearly rules,
// found through the public /api/holidays), and the title prefix below. Everything it creates
// (including a temporary admin) is hard-deleted at the end, even if a step fails.
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { connectAsOwner } from './lib/owner-db';
import { askHidden } from './lib/prompt';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const ORIGIN = process.env.APP_ORIGIN;
const MARK = '[TEST-HOLIDAYS]';
// Chosen at run time by findFreeWindow(): WINDOW is 14 days, MINE the 3 days inside it, MID the middle one.
let MINE = { start: '', end: '' };
let WINDOW = { from: '', to: '' };
let MID = '';

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** First 14-day window from 2090 on with no occurrence at all in /api/holidays. */
async function findFreeWindow() {
  for (let i = 0; i < 80; i++) {
    const from = addDays('2090-01-01', i * 14);
    const to = addDays(from, 13);
    const r = await fetch(`${BASE}/api/holidays?from=${from}&to=${to}&t=${Date.now()}`);
    const j = (await r.json()) as { holidays: unknown[] };
    if (j.holidays.length === 0) {
      WINDOW = { from, to };
      MINE = { start: addDays(from, 2), end: addDays(from, 4) };
      MID = addDays(from, 3);
      return true;
    }
  }
  return false;
}

let failed = 0;
let skipped = 0;
const check = (name: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return pass;
};
const skip = (name: string, why: string) => {
  skipped++;
  console.log(`SKIP  ${name}  (${why})`);
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
      // not JSON (e.g. an HTML error page): leave json null
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

async function publicList() {
  const r = await fetch(`${BASE}/api/holidays?from=${WINDOW.from}&to=${WINDOW.to}&t=${Date.now()}`);
  const j = (await r.json()) as {
    holidays: { id: number; label: string; updatedBy: { name: string } }[];
  };
  return j.holidays;
}

async function cleanup() {
  const { pool } = connectAsOwner();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const like = `${MARK}%`;
    await client.query(
      'delete from audit_log where holiday_id in (select id from holidays where title like $1)',
      [like],
    );
    await client.query('delete from holidays where title like $1', [like]); // audience cascades
    // This run's temp admin, plus any left behind by an earlier crashed run.
    const tmp = `select id from admins where email like 'tmp-%@example.invalid'`;
    await client.query(`delete from sessions where admin_id in (${tmp})`);
    await client.query(`delete from audit_log where admin_id in (${tmp})`);
    await client.query(`delete from admins where id in (${tmp})`);
    await client.query('commit');

    const left = await client.query('select count(*)::int as n from holidays where title like $1', [
      like,
    ]);
    const adm = await client.query(
      `select count(*)::int as n from admins where email like 'tmp-%@example.invalid'`,
    );
    check(
      'cleanup: test holidays and temporary admin hard-deleted',
      left.rows[0].n === 0 && adm.rows[0].n === 0,
      `holidays left ${left.rows[0].n}, temp admins left ${adm.rows[0].n}`,
    );
  } catch (e) {
    await client.query('rollback').catch(() => {});
    check('cleanup: test holidays and temporary admin hard-deleted', false, String(e));
  } finally {
    client.release();
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

  if (!(await findFreeWindow())) throw new Error('No holiday-free 2-week window found after 2090.');
  console.log(`Using the empty window ${WINDOW.from} .. ${WINDOW.to}\n`);

  const me = new Client();
  const login = await me.login(email, password);
  if (!check('0. log in as you', login.status === 200, `status ${login.status}`)) process.exit(1);
  const myName: string = login.json.admin.name;
  const myId: number = login.json.admin.id;

  const structure = (await (await fetch(`${BASE}/api/structure`)).json()) as {
    departments: { id: number; code: string }[];
    series: { id: number; departmentId: number; intakeYear: number }[];
  };
  const dept = (code: string) => structure.departments.find((d) => d.code === code)!.id;
  const eee23 = structure.series.find(
    (s) => s.departmentId === dept('EEE') && s.intakeYear === 2023,
  )!.id;

  const empty = await me.call('POST', '/api/admin/holidays/check-overlap', {
    title: 'probe',
    startDate: MINE.start,
    endDate: MINE.end,
    audience: [{ scopeType: 'ALL' }],
  });
  if (
    !check(
      `   test window ${WINDOW.from} .. ${WINDOW.to} is empty`,
      empty.status === 200 && empty.json.conflicts.length === 0,
      `status ${empty.status}`,
    )
  ) {
    process.exit(1);
  }

  try {
    // 1. create mine
    const created = await me.call('POST', '/api/admin/holidays', {
      title: `${MARK} CSE + EEE`,
      note: 'created by test:holidays',
      startDate: MINE.start,
      endDate: MINE.end,
      audience: [
        { scopeType: 'DEPARTMENT', scopeId: dept('CSE') },
        { scopeType: 'DEPARTMENT', scopeId: dept('EEE') },
      ],
    });
    const mine = created.json?.holiday;
    const mineId: number | undefined = mine?.id;
    check(
      '1. create a CSE + EEE holiday (201, createdBy = you)',
      created.status === 201 && mine.createdBy.name === myName && mine.updatedBy.id === myId,
      `status ${created.status}`,
    );
    if (!mineId) return skip('2-9', 'creation failed');

    // 2. public API
    const listed = (await publicList()).find((h) => h.id === mineId);
    check(
      '2. appears in /api/holidays with label "CSE · EEE" and updatedBy = you',
      listed?.label === 'CSE · EEE' && listed.updatedBy.name === myName,
      listed ? `label "${listed.label}"` : 'not listed',
    );

    // 3. audit
    const audit1 = await me.call('GET', `/api/admin/audit?holidayId=${mineId}`);
    const createEntry = audit1.json?.entries?.find(
      (e: { action: string }) => e.action === 'CREATE',
    );
    check(
      '3. audit log has a CREATE entry by you',
      createEntry?.admin.name === myName && createEntry.after?.title === `${MARK} CSE + EEE`,
    );

    // 4. temporary admin
    const tmpPassword = randomBytes(18).toString('hex');
    const tmpName = `Temp Admin ${randomBytes(2).toString('hex')}`;
    const tmpEmail = `tmp-${randomBytes(5).toString('hex')}@example.invalid`;
    const { pool } = connectAsOwner();
    try {
      await pool.query('insert into admins (name, email, password_hash) values ($1, $2, $3)', [
        tmpName,
        tmpEmail,
        await hash(tmpPassword),
      ]);
    } finally {
      await pool.end();
    }
    const other = new Client();
    const otherLogin = await other.login(tmpEmail, tmpPassword);
    if (
      !check(
        '4. create a temporary admin and log in as them',
        otherLogin.status === 200,
        `status ${otherLogin.status}`,
      )
    ) {
      return skip('5-9', 'temporary admin cannot log in');
    }

    // 5. overlap -> 409
    const overlapBody = {
      title: `${MARK} EEE-23 overlap`,
      startDate: MID,
      endDate: MID,
      audience: [{ scopeType: 'SERIES', scopeId: eee23 }],
    };
    const blocked = await other.call('POST', '/api/admin/holidays', overlapBody);
    const c0 = blocked.json?.conflicts?.[0];
    check(
      '5. overlapping EEE-23 holiday -> 409 OVERLAP, names you as createdBy',
      blocked.status === 409 &&
        blocked.json.error.code === 'OVERLAP' &&
        c0?.id === mineId &&
        c0.createdBy.name === myName &&
        c0.sharedLabel === 'EEE-23' &&
        c0.overlap.startDate === MID,
      `status ${blocked.status}, shared "${c0?.sharedLabel}", createdBy "${c0?.createdBy?.name}"`,
    );
    const afterBlocked = (await publicList()).length;
    check(
      '   nothing was saved by the 409',
      afterBlocked === 1,
      `${afterBlocked} test holiday(s) listed`,
    );

    // 6. confirm
    const confirmed = await other.call('POST', '/api/admin/holidays', {
      ...overlapBody,
      confirmOverlap: true,
    });
    const id2: number | undefined = confirmed.json?.holiday?.id;
    check(
      '6. retry with confirmOverlap -> 201',
      confirmed.status === 201 && !!id2,
      `status ${confirmed.status}`,
    );
    if (id2) {
      const a2 = await me.call('GET', `/api/admin/audit?holidayId=${id2}`);
      const ids = a2.json?.entries?.[0]?.after?.confirmedOverlapWith;
      check(
        '   audit records confirmedOverlapWith = [your holiday]',
        JSON.stringify(ids) === JSON.stringify([mineId]),
        JSON.stringify(ids),
      );
    }

    // 7. edit by the other admin
    const edited = await other.call('PATCH', `/api/admin/holidays/${mineId}`, {
      title: `${MARK} CSE + EEE (edited)`,
      note: 'edited by the temporary admin',
    });
    const detail = await me.call('GET', `/api/admin/holidays/${mineId}`);
    const d = detail.json?.holiday;
    check(
      '7. another admin edits your holiday: updatedBy = them, createdBy still you',
      edited.status === 200 &&
        d?.updatedBy.name === tmpName &&
        d.createdBy.name === myName &&
        d.note === 'edited by the temporary admin',
      `status ${edited.status}, updatedBy "${d?.updatedBy?.name}"`,
    );
    const pub = (await publicList()).find((h) => h.id === mineId);
    check('   public API shows updatedBy = them', pub?.updatedBy.name === tmpName);

    // 8. delete
    const del = await me.call('DELETE', `/api/admin/holidays/${mineId}`);
    const afterDel = (await publicList()).some((h) => h.id === mineId);
    const stillThere = await me.call('GET', `/api/admin/holidays/${mineId}`);
    const delAgain = await me.call('DELETE', `/api/admin/holidays/${mineId}`);
    check(
      '8. delete: gone from the public API, still readable by admins with deletedAt',
      del.status === 200 &&
        !afterDel &&
        !!stillThere.json?.holiday?.deletedAt &&
        delAgain.status === 404,
      `delete ${del.status}, listed ${afterDel}, delete again ${delAgain.status}`,
    );

    // 9. restore
    const restored = await me.call('POST', `/api/admin/holidays/${mineId}/restore`);
    const backAgain = (await publicList()).some((h) => h.id === mineId);
    const restoreAgain = await me.call('POST', `/api/admin/holidays/${mineId}/restore`);
    check(
      '9. restore: listed again, reports the clash with the other holiday',
      restored.status === 200 &&
        restored.json.holiday.deletedAt === null &&
        backAgain &&
        restored.json.conflicts.some((c: { id: number }) => c.id === id2) &&
        restoreAgain.status === 409,
      `restore ${restored.status}, listed ${backAgain}, restore again ${restoreAgain.status}`,
    );
    const finalAudit = await me.call('GET', `/api/admin/audit?holidayId=${mineId}`);
    const actions = (finalAudit.json?.entries ?? [])
      .map((e: { action: string }) => e.action)
      .reverse();
    check(
      '   audit history is CREATE, UPDATE, DELETE, RESTORE',
      JSON.stringify(actions) === JSON.stringify(['CREATE', 'UPDATE', 'DELETE', 'RESTORE']),
      actions.join(','),
    );

    // keep the temp client for the post-cleanup check
    (globalThis as { __other?: Client }).__other = other;
  } finally {
    await cleanup();
    const other = (globalThis as { __other?: Client }).__other;
    if (other) {
      const r = await other.call('GET', '/api/auth/me');
      check(
        '   deleted temporary admin can no longer use their session',
        r.status === 401,
        `status ${r.status}`,
      );
    }
    await me.call('POST', '/api/auth/logout');
  }
}

main()
  .then(() => {
    console.log(
      failed === 0 && skipped === 0
        ? '\nAll checks passed.'
        : `\n${failed} check(s) FAILED, ${skipped} skipped.`,
    );
    process.exit(failed === 0 && skipped === 0 ? 0 : 1);
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
