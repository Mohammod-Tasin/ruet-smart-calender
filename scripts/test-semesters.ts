// Live end-to-end check of the semester API. Needs `npm run dev` running.
//   npm run test:semesters   -> asks for your email + password (hidden)
// Starts test semesters for EEE-23, EEE-24 and CSE-23 far in the future (2090), adds an EEE-only
// full-week holiday in a free window and checks that only the EEE series shift by one week.
// Everything it creates is hard-deleted at the end, even if a step fails. It refuses to run if
// one of those series already has an active semester (it never touches real data).
import { createInterface } from 'node:readline/promises';
import { connectAsOwner } from './lib/owner-db';
import { askHidden } from './lib/prompt';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const ORIGIN = process.env.APP_ORIGIN;
const MARK = '[TEST-SEMESTERS]';
const LABEL = 'TEST-SEM';

let failed = 0;
const check = (name: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return pass;
};

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

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

/** First 14-day window from 2090 on with no occurrence at all in /api/holidays. */
async function findFreeWindow(): Promise<string | null> {
  for (let i = 0; i < 80; i++) {
    const from = addDays('2090-01-01', i * 14);
    const r = await fetch(
      `${BASE}/api/holidays?from=${from}&to=${addDays(from, 13)}&t=${Date.now()}`,
    );
    const j = (await r.json()) as { holidays: unknown[] };
    if (j.holidays.length === 0) return from;
  }
  return null;
}

const created = { semesterIds: [] as number[] };

async function cleanup() {
  const { pool } = connectAsOwner();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const ids = (
      await client.query('select id from semesters where label = $1 or id = any($2::int[])', [
        LABEL,
        created.semesterIds,
      ])
    ).rows.map((r) => r.id as number);
    const holidayIds = (
      await client.query('select id from holidays where title like $1', [`${MARK}%`])
    ).rows.map((r) => r.id as number);

    await client.query(
      `delete from audit_log where (entity_type like 'SEMESTER%' and entity_id = any($1::bigint[]))
         or holiday_id = any($2::bigint[])`,
      [ids, holidayIds],
    );
    await client.query('delete from semester_checkpoints where semester_id = any($1::int[])', [
      ids,
    ]);
    await client.query('delete from semester_week_overrides where semester_id = any($1::int[])', [
      ids,
    ]);
    await client.query('delete from semester_pins where semester_id = any($1::int[])', [ids]);
    await client.query('delete from semesters where id = any($1::int[])', [ids]);
    await client.query('delete from holidays where id = any($1::bigint[])', [holidayIds]);
    await client.query('commit');

    const left = await client.query(
      `select (select count(*) from semesters where label = $1)::int as sem,
              (select count(*) from holidays where title like $2)::int as hol`,
      [LABEL, `${MARK}%`],
    );
    check(
      'cleanup: test semesters, their rows, audit entries and the test holiday hard-deleted',
      left.rows[0].sem === 0 && left.rows[0].hol === 0,
      `semesters left ${left.rows[0].sem}, holidays left ${left.rows[0].hol}`,
    );
  } catch (e) {
    await client.query('rollback').catch(() => {});
    check('cleanup: test data hard-deleted', false, String(e));
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

  const win = await findFreeWindow();
  if (!win) throw new Error('No holiday-free 2-week window found after 2090.');
  // The holiday week: the first Saturday in the free window, Sat..Wed. The semester starts a
  // week earlier, so that week is class week 2 (an extendable phase).
  let sat = win;
  while (weekday(sat) !== 6) sat = addDays(sat, 1);
  const start = addDays(sat, -7);
  console.log(
    `Free window ${win}; semester starts ${start}; holiday week ${sat} .. ${addDays(sat, 4)}\n`,
  );

  const me = new Client();
  const login = await me.login(email, password);
  if (!check('0. log in as you', login.status === 200, `status ${login.status}`)) process.exit(1);

  const structure = (await (await fetch(`${BASE}/api/structure`)).json()) as {
    departments: { id: number; code: string }[];
    series: { id: number; departmentId: number; intakeYear: number }[];
  };
  const dept = (code: string) => structure.departments.find((d) => d.code === code)!.id;
  const find = (code: string, year: number) =>
    structure.series.find((s) => s.departmentId === dept(code) && s.intakeYear === year)!.id;
  const eee23 = find('EEE', 2023);
  const eee24 = find('EEE', 2024);
  const cse23 = find('CSE', 2023);

  const existing = await me.call('GET', '/api/admin/semesters');
  const busy = (existing.json?.semesters ?? []).filter(
    (s: { seriesId: number; status: string }) =>
      s.status === 'ACTIVE' && [eee23, eee24, cse23].includes(s.seriesId),
  );
  if (busy.length > 0) {
    console.log('EEE-23, EEE-24 or CSE-23 already has an active semester. Not touching real data.');
    process.exit(1);
  }

  const timeline = async (id: number) => {
    const r = await fetch(`${BASE}/api/semesters/${id}/timeline?date=${start}&t=${Date.now()}`);
    return { status: r.status, json: await r.json() };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const weekOf = (tl: any, weekStart: string) =>
    tl.weeks.find((w: { weekStart: string }) => w.weekStart === weekStart);

  try {
    // 1. bulk start
    const started = await me.call('POST', '/api/admin/semesters/bulk', {
      seriesIds: [eee23, eee24, cse23],
      startDate: start,
      label: LABEL,
    });
    const ids: number[] = started.json?.semesterIds ?? [];
    created.semesterIds.push(...ids);
    if (
      !check(
        '1. bulk start for EEE-23, EEE-24, CSE-23 (201, 3 semesters)',
        started.status === 201 && ids.length === 3,
        `status ${started.status}`,
      )
    ) {
      return;
    }
    const [sEee23, sEee24, sCse23] = ids as [number, number, number];

    // 2. second start for the same series is refused
    const again = await me.call('POST', '/api/admin/semesters/bulk', {
      seriesIds: [eee23],
      startDate: start,
    });
    check(
      '2. starting EEE-23 again while active -> 422',
      again.status === 422,
      `status ${again.status}`,
    );

    // 3. public status
    const day = addDays(start, 2);
    const status = await (await fetch(`${BASE}/api/status?date=${day}&t=${Date.now()}`)).json();
    const mine = status.series.filter((s: { semesterId: number }) => ids.includes(s.semesterId));
    check(
      '3. /api/status lists the 3 series, in a class phase, with a next milestone',
      mine.length === 3 &&
        mine.every(
          (s: { state: { phase: string; nextMilestone: unknown } }) =>
            s.state.phase === 'CLASS' && s.state.nextMilestone,
        ),
      mine
        .map((s: { series: string; state: { label: string } }) => `${s.series}: ${s.state.label}`)
        .join('; '),
    );

    // 4. baseline timelines
    const before = await Promise.all([sEee23, sEee24, sCse23].map(timeline));
    const baseEnd = before.map((b) => b.json.endDate as string);
    check(
      '4. public timelines load (3 x 200, completed, 19 counted weeks)',
      before.every(
        (b) =>
          b.status === 200 &&
          b.json.completed &&
          b.json.weeks.filter((w: { status: string }) => w.status === 'COUNTED').length === 19,
      ),
      baseEnd.join(', '),
    );

    // 5. impact preview of the EEE-only week
    const eeeAudience = [{ scopeType: 'DEPARTMENT', scopeId: dept('EEE') }];
    const impact = await me.call('POST', '/api/admin/impact', {
      add: [{ startDate: sat, endDate: addDays(sat, 4), audience: eeeAudience }],
    });
    const groups = impact.json?.groups ?? [];
    check(
      '5. impact preview: EEE-23 and EEE-24 +1 week, CSE-23 not mentioned',
      impact.status === 200 &&
        groups.length === 1 &&
        JSON.stringify([...groups[0].labels].sort()) === JSON.stringify(['EEE-23', 'EEE-24']) &&
        groups[0].endShiftWeeks === 1,
      JSON.stringify(
        groups.map((g: { labels: string[]; endShiftWeeks: number }) => [g.labels, g.endShiftWeeks]),
      ),
    );

    // 6. add the EEE-only full-week holiday for real
    const holiday = await me.call('POST', '/api/admin/holidays', {
      title: `${MARK} EEE full week`,
      startDate: sat,
      endDate: addDays(sat, 4),
      audience: eeeAudience,
    });
    check(
      '6. add an EEE-only Sat-Wed holiday (201)',
      holiday.status === 201,
      `status ${holiday.status}`,
    );

    // 7. only EEE shifts
    const after = await Promise.all([sEee23, sEee24, sCse23].map(timeline));
    const shift = (i: number) =>
      (Date.parse(after[i]!.json.endDate) - Date.parse(baseEnd[i]!)) / (7 * 86_400_000);
    check(
      '7. EEE-23 and EEE-24 end 1 week later; CSE-23 unchanged',
      shift(0) === 1 && shift(1) === 1 && shift(2) === 0,
      `shifts ${shift(0)}, ${shift(1)}, ${shift(2)} weeks`,
    );
    check(
      '   the holiday week is HOLIDAY_SKIPPED for EEE and COUNTED for CSE',
      weekOf(after[0]!.json, sat)?.status === 'HOLIDAY_SKIPPED' &&
        weekOf(after[1]!.json, sat)?.status === 'HOLIDAY_SKIPPED' &&
        weekOf(after[2]!.json, sat)?.status === 'COUNTED',
    );

    // 8. status page agrees
    const status2 = await (await fetch(`${BASE}/api/status?date=${day}&t=${Date.now()}`)).json();
    const delayed = (id: number) =>
      status2.series.find((s: { semesterId: number }) => s.semesterId === id)?.state.delayedWeeks;
    const delayed0 = (id: number) =>
      status.series.find((s: { semesterId: number }) => s.semesterId === id)?.state.delayedWeeks;
    check(
      '8. /api/status delayedWeeks: EEE +1, CSE same as before',
      delayed(sEee23) === delayed0(sEee23) + 1 &&
        delayed(sEee24) === delayed0(sEee24) + 1 &&
        delayed(sCse23) === delayed0(sCse23),
    );

    // 9. checkpoint
    const cp = await me.call('POST', '/api/admin/semesters/checkpoints/bulk', {
      semesterIds: [sEee23, sEee24],
      asOfDate: addDays(sat, 14),
      phase: 'CLASS',
      weekIndex: 9,
    });
    const tlCp = await timeline(sEee23);
    check(
      '9. checkpoint "class week 9" re-syncs both EEE semesters',
      cp.status === 201 && weekOf(tlCp.json, addDays(sat, 14))?.classWeekNo === 9,
      `status ${cp.status}`,
    );
    for (const id of cp.json?.checkpointIds ?? [])
      await me.call('DELETE', `/api/admin/semesters/checkpoints/${id}`);
    const tlCp2 = await timeline(sEee23);
    check(
      '   deleting the checkpoints restores the computed timeline',
      tlCp2.json.endDate === after[0]!.json.endDate,
    );

    // 10. week override
    const forced = addDays(sat, 21);
    const ov = await me.call('PUT', `/api/admin/semesters/${sEee23}/week-overrides`, {
      weekStart: forced,
      mode: 'FORCE_EXTEND',
    });
    const tlOv = await timeline(sEee23);
    // The end date is NOT a safe thing to compare: in 2090 the extra week can move the mid break
    // into a vacation, which then costs nothing (see tests/timeline.test.ts). What an extension
    // does guarantee is that the week is skipped and the class week it replaced comes a week later.
    type W = { weekStart: string; status: string; classWeekNo: number | null };
    const wasWeekNo = weekOf(after[0]!.json, forced)?.classWeekNo;
    const nextCounted = (tlOv.json.weeks as W[]).find(
      (w) => w.weekStart > forced && w.status === 'COUNTED',
    );
    const baseNext = (after[0]!.json.weeks as W[]).find(
      (w) => w.weekStart > forced && w.status === 'COUNTED',
    );
    check(
      '10. FORCE_EXTEND skips that week; the class week it replaced moves to the next counted week',
      ov.status === 200 &&
        weekOf(tlOv.json, forced)?.status === 'FORCED_SKIP' &&
        typeof wasWeekNo === 'number' &&
        nextCounted?.classWeekNo === wasWeekNo &&
        baseNext?.classWeekNo === wasWeekNo + 1,
      `week ${forced} was class week ${wasWeekNo}; next counted week is ${nextCounted?.classWeekNo}`,
    );
    await me.call('DELETE', `/api/admin/semesters/${sEee23}/week-overrides`, { weekStart: forced });

    // 11. pin
    const finals = tlOv.json.weeks.find(
      (w: { phase: string; status: string }) => w.phase === 'FINALS' && w.status === 'COUNTED',
    );
    const pinDate = addDays(
      after[1]!.json.weeks.find(
        (w: { phase: string; status: string }) => w.phase === 'FINALS' && w.status === 'COUNTED',
      ).weekStart,
      14,
    );
    const pin = await me.call('PUT', `/api/admin/semesters/${sEee24}/pins`, {
      phase: 'FINALS',
      startDate: pinDate,
    });
    const tlPin = await timeline(sEee24);
    const pinned = tlPin.json.weeks.find(
      (w: { phase: string; status: string }) => w.phase === 'FINALS' && w.status === 'COUNTED',
    );
    check(
      '11. pinning FINALS two weeks later makes it start on the pin',
      !!finals && pin.status === 200 && pinned?.weekStart === pinDate,
      `finals start ${pinned?.weekStart}, wanted ${pinDate}`,
    );
    await me.call('DELETE', `/api/admin/semesters/${sEee24}/pins`, { phase: 'FINALS' });

    // 12. complete + status
    const done = await me.call('POST', `/api/admin/semesters/${sCse23}/complete`);
    // No ?date: a completed semester is listed for 60 days from today, whatever date is viewed.
    const status3 = await (await fetch(`${BASE}/api/status?t=${Date.now()}`)).json();
    const cseState = status3.series.find(
      (s: { semesterId: number }) => s.semesterId === sCse23,
    )?.state;
    check(
      '12. complete CSE-23: status shows COMPLETED, labelled, with no next milestone',
      done.status === 200 &&
        cseState?.phase === 'COMPLETED' &&
        cseState.label === 'Semester completed' &&
        cseState.nextMilestone === null,
      `phase ${cseState?.phase}, label "${cseState?.label}"`,
    );

    // 13. soft delete
    const del = await me.call('DELETE', `/api/admin/semesters/${sEee24}`);
    const gone = await timeline(sEee24);
    check(
      '13. soft-deleting EEE-24: its timeline is 404',
      del.status === 200 && gone.status === 404,
      `delete ${del.status}, timeline ${gone.status}`,
    );

    // 14. audit rows exist for every kind of write (checked directly, then cleaned up below)
    const { pool } = connectAsOwner();
    try {
      const rows = await pool.query(
        `select entity_type, count(*)::int as n from audit_log
          where entity_type like 'SEMESTER%' and entity_id = any($1::bigint[]) group by 1`,
        [ids],
      );
      const kinds = new Set(rows.rows.map((r) => r.entity_type as string));
      check(
        '14. audit_log has SEMESTER, CHECKPOINT, WEEK_OVERRIDE and PIN entries',
        ['SEMESTER', 'SEMESTER_CHECKPOINT', 'SEMESTER_WEEK_OVERRIDE', 'SEMESTER_PIN'].every((k) =>
          kinds.has(k),
        ),
        [...kinds].join(', '),
      );
    } finally {
      await pool.end();
    }
  } finally {
    await cleanup();
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
