import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import type { Conflict } from '@/lib/api';
import {
  gateBreak,
  PAST_BREAK_MESSAGE,
  postBreak,
  type BreakDeps,
} from '@/lib/break-save';

const TODAY = '2026-11-10';
const FUTURE = { startDate: '2026-12-03', endDate: '2026-12-11' };
const PAST = { startDate: '2026-11-05', endDate: '2026-11-13' }; // starts before today
const AUD = [{ scopeType: 'SERIES' as const, scopeId: 1 }];
const clash = { id: 7, title: 'Eid', sharedLabel: 'CSE-23' } as unknown as Conflict;

function deps(over: Partial<BreakDeps> & { conflicts?: unknown[]; agree?: boolean } = {}) {
  const ask = vi.fn<BreakDeps['ask']>(async () => over.agree ?? true);
  const post = vi.fn<BreakDeps['post']>(async () => ({ ok: true }));
  const d: BreakDeps = {
    today: TODAY,
    check: async () => (over.conflicts ?? []) as never,
    ask,
    post,
    ...over,
  };
  return { d, ask, post };
}

describe('gateBreak: look first, ask only when there is something to ask about', () => {
  test('nothing found: no question, no confirm flags', async () => {
    const { d, ask } = deps();
    expect(await gateBreak(FUTURE, AUD, d)).toEqual({});
    expect(ask).not.toHaveBeenCalled();
  });

  test.each([
    ['overlap only', FUTURE, [clash], { confirmOverlap: true, confirmPast: undefined }],
    ['past only', PAST, [], { confirmOverlap: undefined, confirmPast: true }],
    ['both', PAST, [clash], { confirmOverlap: true, confirmPast: true }],
  ])('%s: asks once, then sends only what was asked about', async (_n, range, conflicts, want) => {
    const { d, ask } = deps({ conflicts });
    expect(await gateBreak(range, AUD, d)).toEqual(want);
    expect(ask).toHaveBeenCalledTimes(1);
    const q = ask.mock.calls[0]![0];
    expect(q.conflicts).toHaveLength(conflicts.length);
    expect(q.past).toBe(range === PAST ? PAST_BREAK_MESSAGE : null);
  });

  test('a break that starts today or later is not "past"', async () => {
    const { d, ask } = deps();
    await gateBreak({ startDate: TODAY, endDate: '2026-11-18' }, AUD, d);
    expect(ask).not.toHaveBeenCalled();
  });

  test('cancel returns null', async () => {
    const { d } = deps({ conflicts: [clash], agree: false });
    expect(await gateBreak(FUTURE, AUD, d)).toBeNull();
  });
});

describe('postBreak: exactly the agreed flags, and a second look if the server knows more', () => {
  const base = { title: 'Unofficial Break', ...FUTURE, audience: AUD };

  test('clean save sends no confirm flags', async () => {
    const { d, post } = deps();
    expect(await postBreak(base, {}, d)).toEqual({ ok: true });
    const sent = post.mock.calls[0]![0];
    expect(sent).not.toHaveProperty('confirmOverlap');
    expect(sent).not.toHaveProperty('confirmPast');
  });

  test('server answers OVERLAP unexpectedly: asks, then resends with confirmOverlap only', async () => {
    const { d, ask, post } = deps();
    post
      .mockResolvedValueOnce({
        ok: false,
        code: 'OVERLAP',
        message: 'x',
        conflicts: [clash],
      } as never)
      .mockResolvedValueOnce({ ok: true });
    expect(await postBreak(base, {}, d)).toEqual({ ok: true });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[1]![0]).toMatchObject({ confirmOverlap: true });
    expect(post.mock.calls[1]![0]).not.toHaveProperty('confirmPast');
  });

  test('server answers PAST_CONFIRM unexpectedly: asks with its message', async () => {
    const { d, ask, post } = deps();
    post
      .mockResolvedValueOnce({ ok: false, code: 'PAST_CONFIRM', message: 'recalculates 3 series' })
      .mockResolvedValueOnce({ ok: true });
    await postBreak(base, {}, d);
    expect(ask.mock.calls[0]![0]).toEqual({ conflicts: [], past: 'recalculates 3 series' });
    expect(post.mock.calls[1]![0]).toMatchObject({ confirmPast: true });
  });

  test('declining the second question cancels and does not resend', async () => {
    const { d, post } = deps({ agree: false });
    post.mockResolvedValueOnce({
      ok: false,
      code: 'OVERLAP',
      message: 'x',
      conflicts: [clash],
    } as never);
    const r = await postBreak(base, {}, d);
    expect(r).toMatchObject({ ok: false, cancelled: true });
    expect(post).toHaveBeenCalledTimes(1);
  });

  test('any other error is returned as is, without a question', async () => {
    const { d, ask, post } = deps();
    post.mockResolvedValueOnce({ ok: false, code: 'UNPROCESSABLE', message: 'Bad dates' });
    expect(await postBreak(base, {}, d)).toEqual({
      ok: false,
      cancelled: false,
      message: 'Bad dates',
    });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('no forced confirms in the Series Board or the add forms', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  test('SeriesBoard never hard-codes a confirm flag and uses the pre-check', () => {
    const s = src('src/components/SeriesBoard.tsx');
    expect(s).not.toMatch(/confirm(Overlap|Past): true/);
    expect(s).toContain('gateBreak');
    expect(s).toContain('postBreak');
    expect(s).toContain("'PAST_CONFIRM'"); // removing a past break
  });
  test('the quick yearly-holiday form no longer forces confirmPast', () => {
    expect(src('src/components/YearlyHolidays.tsx')).not.toMatch(/endDate: end, confirmPast: true/);
  });
});
