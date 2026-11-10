import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { weekendNote, weekendRange, trimNote } from '@/lib/format';
import { weekTip } from '@/lib/journey-ui';

const OFF = [4, 5]; // Thu, Fri
const src = (p: string) => readFileSync(p, 'utf8');

describe('weekend text (HolidayCard / OccurrenceSheet / TrimHint)', () => {
  test('Sat-Wed holiday: students are off Thu to Fri around it', () => {
    const r = { startDate: '2026-10-17', endDate: '2026-10-21' };
    expect(weekendRange(r, OFF)).toBe('15–23 Oct');
    expect(weekendNote(r, OFF)).toContain('Students will be off');
  });
  test('nothing to add when the weekend is already inside, or not adjacent', () => {
    expect(weekendRange({ startDate: '2026-10-15', endDate: '2026-10-23' }, OFF)).toBeNull();
    expect(weekendRange({ startDate: '2026-10-18', endDate: '2026-10-19' }, OFF)).toBeNull();
  });
  test('post-save trim note names the weekly off days and the saved range', () => {
    expect(trimNote({ startDate: '2026-10-17', endDate: '2026-10-21' }, OFF)).toBe(
      'Thursday and Friday are weekly holidays, so we saved 17–21 Oct.',
    );
  });
});

describe('week strip tooltip (Saturday dates)', () => {
  const w = {
    weekStart: '2026-10-03',
    status: 'COUNTED' as const,
    phase: 'CLASS' as const,
    weekNo: 2,
    skipReasons: [],
  };
  test('class week starts on Saturday and ends Wednesday', () => {
    expect(weekTip(w)).toBe('Sat 3 Oct – Wed 7 Oct · Class week 2');
  });
  test('holiday week names the holiday', () => {
    const tip = weekTip({
      ...w,
      status: 'SKIPPED',
      skipReasons: [{ title: 'Sanatani Holiday', category: 'HOLIDAY' }],
    } as never);
    expect(tip).toContain('Holiday week: Sanatani Holiday');
  });
});

// Guards against a UI rewrite dropping these again (PR #2 did; see the recovery PR).
describe('restored Phase 14 pieces stay wired in', () => {
  test('past protection: the admin calendar never forces confirmPast', () => {
    const s = src('src/components/AdminCalendar.tsx');
    expect(s).toContain("'PAST_CONFIRM'");
    expect(s).toContain('PastConfirm');
    expect(s.match(/confirmPast: true/g)?.length).toBe(1); // only the "after the admin confirmed" spread
  });
  test('month grid widens bars over weekly off days', () => {
    const s = src('src/components/MonthGrid.tsx');
    expect(s).toContain('extendWithAdjacentOffDays');
    expect(s).toContain('barRuns');
  });
  test('editor and occurrence sheet keep the trim hint and weekend line', () => {
    for (const f of ['HolidayEditor', 'OccurrenceSheet']) {
      expect(src(`src/components/${f}.tsx`)).toContain('<TrimHint');
    }
    expect(src('src/components/OccurrenceSheet.tsx')).toContain('With the weekend');
    expect(src('src/components/HolidayCard.tsx')).toContain('With the weekend');
    expect(src('src/components/HolidayEditor.tsx')).toContain('trimNote');
  });
  test('occurrence sheet keeps scopes, undo, stop repeating and the new remove options', () => {
    const s = src('src/components/OccurrenceSheet.tsx');
    for (const t of [
      'and every year after',
      'Every year from',
      'planOccurrenceEdit',
      '/api/admin/rule-edits/undo',
      'Stop repeating',
      'Remove for {year} only',
      'Remove permanently',
      'Edit name',
      'History',
      '<ImpactPreview',
    ]) {
      expect(s, t).toContain(t);
    }
  });
  test('series sheet keeps the week strip next to the academic timeline', () => {
    const s = src('src/components/SeriesSheet.tsx');
    expect(s).toContain('function WeekStrip');
    expect(s).toContain('Academic Timeline');
  });
});
