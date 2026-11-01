'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { audienceFromSeries } from '@/core/calendar/audience';
import { appliesToSeries } from '@/core/calendar/compress';
import { holidaysByDate, parseMonthKey, shiftMonth, todayInDhaka } from '@/core/calendar/grid';
import { addDays, msOf } from '@/core/calendar/hijri';
import { MONTHS_SHORT } from '@/core/calendar/months';
import { weekStartOf } from '@/core/journey/journey';
import {
  api,
  clearHolidayCache,
  type ApiStructure,
  type AuditEntry,
  type Conflict,
  type FullHoliday,
  type PublicHoliday,
} from '@/lib/api';
import { audienceText, dateRange, longDate, monthTitle, stamp } from '@/lib/format';
import { useMonthHolidays, useStructure } from '@/lib/hooks';
import { rangeText } from '@/lib/journey-ui';
import { HolidayCard } from './HolidayCard';
import { HolidayEditor, type EditorTarget } from './HolidayEditor';
import { MonthGrid } from './MonthGrid';
import { MonthHeader } from './MonthHeader';
import { OccurrenceSheet } from './OccurrenceSheet';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { field, primary, small } from './ui';

export const yearlyHref = (year: number) => `/admin?tab=settings&year=${year}`;

const isCommonHoliday = (h: PublicHoliday) =>
  h.label === 'ALL' && h.category === 'HOLIDAY';

type Dialog =
  | { kind: 'day'; date: string; endDate?: string; only?: number }
  | { kind: 'occurrence'; holiday: PublicHoliday }
  | { kind: 'edit'; target: EditorTarget; key: number };

type ViewMode = 'common' | 'dept' | 'all';

/**
 * Admin Calendar:
 * - Initially displays ONLY Common Holidays (`ALL`).
 * - Easy filter bar to view a specific Department/Batch's breaks or all breaks.
 * - Click any day (or "+ Add Holiday / Break") to easily add:
 *   1. Common Holidays (1a Yearly Fixed like 21 Feb / 26 Mar, or 1b Yearly Variable like Eid / Summer Vacation)
 *   2. Mid Break or Unofficial Break (by department / batch)
 *   3. Semester Break (from the day after last exam to the weekend of that week, by department / batch)
 * - 1-click Remove / Edit from either the calendar bar or the monthly holiday list below.
 */
export function AdminCalendar({ offDays }: { offDays: number[] }) {
  const router = useRouter();
  const toast = useToast();
  const today = useMemo(() => todayInDhaka(), []);
  const [ym, setYm] = useState(today.slice(0, 7));
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [rangePick, setRangePick] = useState<null | 'start' | { start: string }>(null);
  const [historyOf, setHistoryOf] = useState<{ id: number; title: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleted, setDeleted] = useState<FullHoliday[]>([]);

  // Initial calendar view: ONLY Common Holidays
  const [viewMode, setViewMode] = useState<ViewMode>('common');
  const [filterDeptId, setFilterDeptId] = useState<number | ''>('');
  const [filterYear, setFilterYear] = useState<number | ''>('');

  const { structure } = useStructure();
  const { cells, holidays, failed } = useMonthHolidays(ym, offDays, { bust: true, version });

  useEffect(() => {
    api<{ holidays: FullHoliday[] }>('/api/admin/holidays/deleted').then((r) => {
      if (r.ok) setDeleted(r.data.holidays);
    });
  }, [version]);

  const refresh = () => {
    clearHolidayCache();
    setVersion((v) => v + 1);
  };
  const editSeq = useRef(0);
  const openEditor = (target: EditorTarget) => {
    editSeq.current += 1;
    setDialog({ kind: 'edit', target, key: editSeq.current });
  };
  const sessionGone = (status: number) => status === 401 && router.replace('/admin/login');

  // Series matching the department/batch filter when `viewMode === 'dept'`
  const filterSeriesIds = useMemo(() => {
    if (!structure || viewMode !== 'dept') return null;
    return structure.series
      .filter(
        (s) =>
          (filterDeptId === '' || s.departmentId === filterDeptId) &&
          (filterYear === '' || s.intakeYear === filterYear),
      )
      .map((s) => s.id);
  }, [structure, viewMode, filterDeptId, filterYear]);

  const visibleHolidays = useMemo(() => {
    if (!holidays) return null;
    if (viewMode === 'common') return holidays.filter(isCommonHoliday);
    if (viewMode === 'all' || !structure || !filterSeriesIds) return holidays;
    return holidays.filter(
      (h) =>
        isCommonHoliday(h) ||
        filterSeriesIds.some((sid) => appliesToSeries(h.audience, structure, sid)),
    );
  }, [holidays, viewMode, structure, filterSeriesIds]);

  // Holidays overlapping the selected month `ym` (for the easy 1-click manage list below the grid)
  const monthHolidays = useMemo(() => {
    if (!visibleHolidays) return [];
    const monthStart = `${ym}-01`;
    const monthEnd = `${ym}-31`;
    return visibleHolidays.filter((h) => h.endDate >= monthStart && h.startDate <= monthEnd);
  }, [visibleHolidays, ym]);

  const hiddenDeptCount = useMemo(() => {
    if (!holidays || viewMode !== 'common') return 0;
    const monthStart = `${ym}-01`;
    const monthEnd = `${ym}-31`;
    return holidays.filter(
      (h) => !isCommonHoliday(h) && h.endDate >= monthStart && h.startDate <= monthEnd,
    ).length;
  }, [holidays, viewMode, ym]);

  const onCell = (date: string, holidayId: number | string | null) => {
    if (rangePick === 'start') {
      setRangePick({ start: date });
      toast(`Start date: ${longDate(date)}. Now click the End Date on the calendar.`);
      return;
    }
    if (rangePick && typeof rangePick === 'object') {
      const [s, e] = rangePick.start <= date ? [rangePick.start, date] : [date, rangePick.start];
      setRangePick(null);
      setDialog({ kind: 'day', date: s, endDate: e });
      return;
    }

    if (holidayId === null) return setDialog({ kind: 'day', date, endDate: date });
    const h = visibleHolidays?.find((x) => x.id === holidayId);
    if (h && typeof h.id === 'string') return setDialog({ kind: 'occurrence', holiday: h });
    setDialog({ kind: 'day', date, endDate: date, only: Number(holidayId) });
  };

  async function removeOneOff(h: { id: number; title: string }) {
    setBusyId(h.id);
    const r = await api(`/api/admin/holidays/${h.id}`, {
      method: 'DELETE',
      body: { confirmPast: true },
    });
    setBusyId(null);
    if (r.ok) {
      toast(`"${h.title}" removed. You can restore it from Recently deleted below.`);
      if (dialog?.kind === 'day' && dialog.only === h.id) setDialog(null);
      refresh();
    } else {
      toast(r.message, 'error');
      sessionGone(r.status);
    }
  }

  async function restore(h: FullHoliday) {
    setBusyId(h.id);
    const r = await api<{ conflicts: Conflict[] }>(`/api/admin/holidays/${h.id}/restore`, {
      method: 'POST',
      body: { confirmPast: true },
    });
    setBusyId(null);
    if (!r.ok) return toast(r.message, 'error');
    const n = r.data.conflicts.length;
    toast(
      n
        ? `"${h.title}" restored (overlaps ${n} other ${n === 1 ? 'holiday' : 'holidays'}).`
        : `"${h.title}" restored.`,
      n ? 'warn' : 'success',
    );
    refresh();
  }

  const dayDate = dialog?.kind === 'day' ? dialog.date : null;
  const only = dialog?.kind === 'day' ? dialog.only : undefined;
  const dayHolidays = (
    dayDate && visibleHolidays ? (holidaysByDate(cells, visibleHolidays).get(dayDate) ?? []) : []
  ).filter((h) => only === undefined || h.id === only);

  const parsedYm = parseMonthKey(ym)!;
  const intakeYears = useMemo(
    () => (structure ? [...new Set(structure.series.map((s) => s.intakeYear))].sort() : []),
    [structure],
  );

  return (
    <div className="space-y-4">
      <MonthHeader
        ym={ym}
        onPrev={() => setYm(shiftMonth(ym, -1))}
        onNext={() => setYm(shiftMonth(ym, 1))}
        onToday={() => setYm(today.slice(0, 7))}
      />

      {/* View Filter (initially Common Holidays Only) + Quick Add Actions */}
      <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/70 p-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
        {rangePick ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-indigo-950 dark:text-indigo-100">
            <span className="font-medium">
              {rangePick === 'start'
                ? '1️⃣ Click the Start Date on the calendar below…'
                : `2️⃣ Start Date: ${longDate(rangePick.start)} — Now click the End Date on the calendar below…`}
            </span>
            <button type="button" onClick={() => setRangePick(null)} className={small}>
              Cancel selection
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Calendar Display Filter */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                Showing:
              </span>
              <button
                type="button"
                onClick={() => setViewMode('common')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  viewMode === 'common'
                    ? 'bg-indigo-600 text-white'
                    : 'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
                }`}
              >
                Common Holidays
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('dept');
                  if (filterDeptId === '' && structure?.departments[0]) {
                    setFilterDeptId(structure.departments[0].id);
                  }
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  viewMode === 'dept'
                    ? 'bg-indigo-600 text-white'
                    : 'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
                }`}
              >
                By Dept / Batch
              </button>
              <button
                type="button"
                onClick={() => setViewMode('all')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  viewMode === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
                }`}
              >
                All Holidays &amp; Dept Breaks
                {hiddenDeptCount > 0 ? ` (+${hiddenDeptCount})` : ''}
              </button>

              {viewMode === 'dept' && structure && (
                <div className="flex items-center gap-1.5 pl-1">
                  <select
                    aria-label="Filter department"
                    value={filterDeptId}
                    onChange={(e) =>
                      setFilterDeptId(e.target.value ? Number(e.target.value) : '')
                    }
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="">All Depts</option>
                    {structure.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter batch"
                    value={filterYear}
                    onChange={(e) => setFilterYear(e.target.value ? Number(e.target.value) : '')}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="">All Batches</option>
                    {intakeYears.map((y) => (
                      <option key={y} value={y}>
                        {String(y % 100).padStart(2, '0')} Series
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Quick Add Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setRangePick('start')} className={small}>
                Pick Start &amp; End on Grid
              </button>
              <button
                type="button"
                onClick={() => setDialog({ kind: 'day', date: today, endDate: today })}
                className={primary}
              >
                + Add Holiday / Break
              </button>
            </div>
          </div>
        )}
      </div>

      {failed ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          Could not load the holidays.{' '}
          <button type="button" className="underline" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : (
        <MonthGrid cells={cells} holidays={visibleHolidays} today={today} onCell={onCell} />
      )}

      {/* Easy Monthly List: 1-click Edit or Remove any holiday in this month */}
      <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">
            Holidays in {monthTitle(parsedYm.year, parsedYm.month)} ({monthHolidays.length})
          </h3>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Click any day on the calendar to add, or remove directly below
          </span>
        </div>
        {monthHolidays.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No holidays shown in this month.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {monthHolidays.map((h) => {
              const isRule = typeof h.id === 'string';
              const typeTag = isRule
                ? h.tentative
                  ? 'Yearly Variable (Expected)'
                  : 'Yearly Common'
                : h.category === 'MID_BREAK'
                  ? 'Mid Break'
                  : h.category === 'UNOFFICIAL_BREAK'
                    ? 'Unofficial Break'
                    : h.category === 'SEMESTER_BREAK'
                      ? 'Semester Break'
                      : h.label === 'ALL'
                        ? 'Common Holiday'
                        : 'Dept Holiday';
              return (
                <li
                  key={h.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{h.title}</span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {typeTag}
                      </span>
                      {h.label !== 'ALL' && (
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                          {audienceText(h.label)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {dateRange(h.startDate, h.endDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isRule ? (
                      <button
                        type="button"
                        className={small}
                        onClick={() => setDialog({ kind: 'occurrence', holiday: h })}
                      >
                        Edit / Remove
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={small}
                          onClick={() => openEditor({ kind: 'edit', id: Number(h.id) })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busyId === h.id}
                          onClick={() => removeOneOff({ id: Number(h.id), title: h.title })}
                          className={`${small} border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/50`}
                        >
                          {busyId === h.id ? 'Removing…' : 'Remove'}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
          Recently deleted ({deleted.length})
        </summary>
        <div className="grid gap-2 p-2 md:grid-cols-2">
          {deleted.length === 0 && (
            <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">
              Nothing has been deleted.
            </p>
          )}
          {deleted.map((h) => (
            <HolidayCard
              key={h.id}
              holiday={h}
              actions={
                <>
                  <button
                    type="button"
                    className={small}
                    disabled={busyId === h.id}
                    onClick={() => restore(h)}
                  >
                    {busyId === h.id ? 'Restoring…' : 'Restore'}
                  </button>
                  <button
                    type="button"
                    className={small}
                    onClick={() => setHistoryOf({ id: h.id, title: h.title })}
                  >
                    History
                  </button>
                </>
              }
            />
          ))}
        </div>
      </details>

      {dialog?.kind === 'day' && structure && (
        <Sheet
          title={only === undefined ? longDate(dialog.date) : (dayHolidays[0]?.title ?? 'Holiday')}
          onClose={() => setDialog(null)}
        >
          <div className="space-y-4">
            {only === undefined && (
              <EasyAddHolidayForm
                structure={structure}
                initialStart={dialog.date}
                initialEnd={dialog.endDate ?? dialog.date}
                offDays={offDays}
                onPickEndOnCalendar={(startDate) => {
                  setDialog(null);
                  setRangePick({ start: startDate });
                  toast(
                    `Start date: ${longDate(startDate)}. Now click the End Date on the calendar.`,
                  );
                }}
                onSaved={(msg, addedDeptId) => {
                  toast(msg);
                  if (addedDeptId && viewMode === 'common') {
                    setFilterDeptId(addedDeptId === 'all' ? '' : addedDeptId);
                    setFilterYear('');
                    setViewMode(addedDeptId === 'all' ? 'all' : 'dept');
                  }
                  setDialog(null);
                  refresh();
                }}
              />
            )}

            {dayHolidays.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Existing on this day
                </p>
                {dayHolidays.map((h) => {
                  const id = h.id;
                  return (
                    <HolidayCard
                      key={id}
                      holiday={h}
                      offDays={offDays}
                      actions={
                        typeof id === 'string' ? (
                          <button
                            type="button"
                            className={small}
                            onClick={() => setDialog({ kind: 'occurrence', holiday: h })}
                          >
                            Change / Remove
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={small}
                              onClick={() => openEditor({ kind: 'edit', id })}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className={small}
                              onClick={() => setHistoryOf({ id, title: h.title })}
                            >
                              History
                            </button>
                            <button
                              type="button"
                              disabled={busyId === id}
                              onClick={() => removeOneOff({ id, title: h.title })}
                              className={`${small} border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/50`}
                            >
                              {busyId === id ? 'Removing…' : 'Remove'}
                            </button>
                          </>
                        )
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        </Sheet>
      )}

      {dialog?.kind === 'occurrence' && (
        <OccurrenceSheet
          key={String(dialog.holiday.id)}
          holiday={dialog.holiday}
          offDays={offDays}
          onClose={() => setDialog(null)}
          onChanged={refresh}
        />
      )}

      {dialog?.kind === 'edit' && structure && (
        <HolidayEditor
          key={dialog.key}
          structure={structure}
          offDays={offDays}
          target={dialog.target}
          onClose={() => setDialog(null)}
          onEditExisting={(id) => openEditor({ kind: 'edit', id })}
          onDone={(message) => {
            toast(message);
            setDialog(null);
            refresh();
          }}
        />
      )}

      {historyOf && <HistorySheet holiday={historyOf} onClose={() => setHistoryOf(null)} />}
    </div>
  );
}

const FIXED_PRESETS = [
  { label: '21 Feb · Shaheed Day', title: 'Shaheed Day & International Mother Language Day', month: 2, day: 21 },
  { label: '26 Mar · Independence Day', title: 'Independence & National Day', month: 3, day: 26 },
  { label: '14 Apr · Pohela Boishakh', title: 'Bengali New Year (Pohela Boishakh)', month: 4, day: 14 },
  { label: '1 May · May Day', title: 'May Day', month: 5, day: 1 },
  { label: '16 Dec · Victory Day', title: 'Victory Day', month: 12, day: 16 },
] as const;

const VARIABLE_PRESETS = [
  'Eid-ul-Fitr Vacation',
  'Eid-ul-Adha Vacation',
  'Summer Vacation',
  'Winter Vacation',
  'Durga Puja Vacation',
] as const;

/** Compute Semester Break dates from the Last Exam Date: day after last exam -> Friday (weekend) of that week. */
function computeSemesterBreakRange(lastExamDate: string): { start: string; end: string } {
  const start = addDays(lastExamDate, 1);
  const examWeekFriday = addDays(weekStartOf(lastExamDate), 6);
  const end = start <= examWeekFriday ? examWeekFriday : addDays(weekStartOf(start), 6);
  return { start, end };
}

/**
 * Easy 3-Tab Holiday / Break Creator matching the 3 holiday types:
 * 1. Common Holiday (for all): 1a Yearly Fixed (21 Feb, 26 Mar...) | 1b Yearly Variable (Eid, Summer...)
 * 2. Mid Break / Unofficial Break (vary department to department)
 * 3. Semester Break (from the day after last exam to the weekend of that week, vary department to department)
 */
function EasyAddHolidayForm({
  structure,
  initialStart,
  initialEnd,
  onPickEndOnCalendar,
  onSaved,
}: {
  structure: ApiStructure;
  initialStart: string;
  initialEnd: string;
  offDays?: number[];
  onPickEndOnCalendar: (startDate: string) => void;
  onSaved: (msg: string, addedDept?: number | 'all') => void;
}) {
  const [tab, setTab] = useState<'common' | 'dept-break' | 'sem-break'>('common');
  const [commonKind, setCommonKind] = useState<'variable' | 'fixed'>('variable');

  // Shared / Common fields
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [repeatYearly, setRepeatYearly] = useState(true);
  const [fixedMonth, setFixedMonth] = useState(() => Number(initialStart.slice(5, 7)));
  const [fixedDay, setFixedDay] = useState(() => Number(initialStart.slice(8, 10)));
  const [fixedLen, setFixedLen] = useState(() =>
    Math.max(1, Math.min(30, Math.round((msOf(initialEnd) - msOf(initialStart)) / 86_400_000) + 1)),
  );

  // Type 2 (Mid / Unofficial Break) & Type 3 (Semester Break) Department / Batch selection
  const [breakCategory, setBreakCategory] = useState<'MID_BREAK' | 'UNOFFICIAL_BREAK'>(
    'UNOFFICIAL_BREAK',
  );
  const [pickedDepts, setPickedDepts] = useState<Set<number>>(new Set());
  const [pickedBatch, setPickedBatch] = useState<number | 'all'>('all');

  // Type 3 (Semester Break): Last Exam Date -> day after last exam to weekend of that week
  const [lastExamDate, setLastExamDate] = useState(initialStart);
  const [semBreakEnd, setSemBreakEnd] = useState(
    () => computeSemesterBreakRange(initialStart).end,
  );

  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intakeYears = useMemo(
    () => [...new Set(structure.series.map((s) => s.intakeYear))].sort(),
    [structure],
  );

  function toggleDept(deptId: number) {
    setPickedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }

  function deptAudience() {
    const ids = structure.series
      .filter(
        (s) =>
          pickedDepts.has(s.departmentId) &&
          (pickedBatch === 'all' || s.intakeYear === pickedBatch),
      )
      .map((s) => s.id);
    return audienceFromSeries(new Set(ids), structure);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (tab === 'common') {
      if (!title.trim()) return setError('Please enter the holiday name.');
      const year = Number(start.slice(0, 4));

      if (commonKind === 'fixed') {
        setSaving(true);
        const r = await api('/api/admin/holiday-rules', {
          method: 'POST',
          body: {
            title: title.trim(),
            category: 'HOLIDAY',
            classesOnly: false,
            audience: [{ scopeType: 'ALL', scopeId: null }],
            effectiveFromYear: year,
            params: {
              kind: 'GREGORIAN_FIXED',
              month: fixedMonth,
              day: fixedDay,
              lengthDays: fixedLen,
            },
          },
        });
        setSaving(false);
        if (!r.ok) return setError(r.message);
        return onSaved(`Yearly fixed holiday "${title.trim()}" added (repeats every year).`);
      }

      // 1b. Yearly Variable Common Holiday
      if (!start || !end || end < start) return setError('End date cannot be before Start date.');
      setSaving(true);
      if (repeatYearly) {
        const len = Math.max(
          1,
          Math.min(60, Math.round((msOf(end) - msOf(start)) / 86_400_000) + 1),
        );
        const cr = await api<{ ruleId: number }>('/api/admin/holiday-rules', {
          method: 'POST',
          body: {
            title: title.trim(),
            category: 'HOLIDAY',
            classesOnly: false,
            audience: [{ scopeType: 'ALL', scopeId: null }],
            effectiveFromYear: year,
            params: { kind: 'MANUAL_YEARLY', defaultLengthDays: len },
          },
        });
        if (!cr.ok) {
          setSaving(false);
          return setError(cr.message);
        }
        const or = await api(`/api/admin/holiday-rules/${cr.data.ruleId}/overrides`, {
          method: 'PUT',
          body: {
            year,
            startDate: start,
            endDate: end,
            note: note.trim() || null,
            confirmPast: true,
          },
        });
        setSaving(false);
        if (!or.ok) return setError(or.message);
        return onSaved(`Yearly variable holiday "${title.trim()}" saved for ${year}.`);
      } else {
        const r = await api('/api/admin/holidays', {
          method: 'POST',
          body: {
            title: title.trim(),
            note: note.trim(),
            category: 'HOLIDAY',
            classesOnly: false,
            startDate: start,
            endDate: end,
            audience: [{ scopeType: 'ALL', scopeId: null }],
            confirmOverlap: true,
            confirmPast: true,
          },
        });
        setSaving(false);
        if (!r.ok) return setError(r.message);
        return onSaved(`Common holiday "${title.trim()}" added.`);
      }
    }

    // Type 2 or Type 3: requires at least one department
    if (pickedDepts.size === 0) {
      return setError('Please select at least one department.');
    }
    const audience = deptAudience();
    if (audience.length === 0) {
      return setError('No active series found for the selected department / batch.');
    }
    const viewDept: number | 'all' =
      pickedDepts.size === 1 ? [...pickedDepts][0]! : 'all';

    if (tab === 'dept-break') {
      if (!start || !end || end < start) return setError('End date cannot be before Start date.');
      const defaultName =
        breakCategory === 'MID_BREAK' ? 'Mid Break' : 'Unofficial Break';
      const finalTitle = title.trim() || defaultName;
      setSaving(true);
      const r = await api('/api/admin/holidays', {
        method: 'POST',
        body: {
          title: finalTitle,
          note: note.trim(),
          category: breakCategory,
          classesOnly: true,
          startDate: start,
          endDate: end,
          audience,
          confirmOverlap: true,
          confirmPast: true,
        },
      });
      setSaving(false);
      if (!r.ok) return setError(r.message);
      return onSaved(`${finalTitle} added (${rangeText(start, end)}).`, viewDept);
    }

    // Type 3: Semester Break (from day after last exam to weekend of that week)
    const semStart = addDays(lastExamDate, 1);
    if (!semBreakEnd || semBreakEnd < semStart) {
      return setError('Semester break end date cannot be before the day after last exam.');
    }
    const finalTitle = title.trim() || 'Semester Break';
    setSaving(true);
    const r = await api('/api/admin/holidays', {
      method: 'POST',
      body: {
        title: finalTitle,
        note: note.trim() || `Last exam on ${rangeText(lastExamDate, lastExamDate)}`,
        category: 'SEMESTER_BREAK',
        classesOnly: true,
        startDate: semStart,
        endDate: semBreakEnd,
        audience,
        confirmOverlap: true,
        confirmPast: true,
      },
    });
    setSaving(false);
    if (!r.ok) return setError(r.message);
    return onSaved(`Semester Break added (${rangeText(semStart, semBreakEnd)}).`, viewDept);
  }

  const semBreakStart = addDays(lastExamDate, 1);

  return (
    <form
      onSubmit={submit}
      className="space-y-3.5 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3.5 dark:border-indigo-900 dark:bg-indigo-950/30"
    >
      {/* 3 Holiday Type Tabs */}
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-200/70 p-1 text-xs font-semibold dark:bg-zinc-800">
        <button
          type="button"
          onClick={() => {
            setTab('common');
            setError(null);
          }}
          className={`rounded-md px-2 py-1.5 ${
            tab === 'common'
              ? 'bg-white text-indigo-700 shadow-sm dark:bg-zinc-900 dark:text-indigo-300'
              : 'text-zinc-600 dark:text-zinc-400'
          }`}
        >
          1. Common (All)
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('dept-break');
            setTitle('');
            if (start === end) {
              const sat = weekStartOf(start);
              setStart(addDays(sat, -2));
              setEnd(addDays(sat, 6));
            }
            setError(null);
          }}
          className={`rounded-md px-2 py-1.5 ${
            tab === 'dept-break'
              ? 'bg-white text-indigo-700 shadow-sm dark:bg-zinc-900 dark:text-indigo-300'
              : 'text-zinc-600 dark:text-zinc-400'
          }`}
        >
          2. Mid / Unofficial
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('sem-break');
            setTitle('');
            setError(null);
          }}
          className={`rounded-md px-2 py-1.5 ${
            tab === 'sem-break'
              ? 'bg-white text-indigo-700 shadow-sm dark:bg-zinc-900 dark:text-indigo-300'
              : 'text-zinc-600 dark:text-zinc-400'
          }`}
        >
          3. Semester Break
        </button>
      </div>

      {/* TAB 1: COMMON HOLIDAYS (1a Fixed & 1b Variable) */}
      {tab === 'common' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCommonKind('variable')}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                commonKind === 'variable'
                  ? 'bg-indigo-600 text-white'
                  : 'border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
              }`}
            >
              b. Yearly Variable (Eid, Summer…)
            </button>
            <button
              type="button"
              onClick={() => setCommonKind('fixed')}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                commonKind === 'fixed'
                  ? 'bg-indigo-600 text-white'
                  : 'border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
              }`}
            >
              a. Yearly Fixed (21 Feb, 26 Mar…)
            </button>
          </div>

          {commonKind === 'fixed' ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {FIXED_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setTitle(p.title);
                      setFixedMonth(p.month);
                      setFixedDay(p.day);
                      setFixedLen(1);
                    }}
                    className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-indigo-950"
                  >
                    + {p.label}
                  </button>
                ))}
              </div>

              <label className="block text-sm font-medium">
                Holiday Name
                <input
                  className={field}
                  placeholder="e.g. Shaheed Day, Independence Day…"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </label>

              <div className="grid grid-cols-3 gap-2">
                <label className="block text-xs font-medium">
                  Month (Every Year)
                  <select
                    className={field}
                    value={fixedMonth}
                    onChange={(e) => setFixedMonth(Number(e.target.value))}
                  >
                    {MONTHS_SHORT.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium">
                  Day
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className={field}
                    value={fixedDay}
                    onChange={(e) => setFixedDay(Math.max(1, Math.min(31, Number(e.target.value))))}
                  />
                </label>
                <label className="block text-xs font-medium">
                  Duration (days)
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className={field}
                    value={fixedLen}
                    onChange={(e) => setFixedLen(Math.max(1, Math.min(30, Number(e.target.value))))}
                  />
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {VARIABLE_PRESETS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setTitle(name)}
                      className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-indigo-950"
                    >
                      + {name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onPickEndOnCalendar(start)}
                  className="text-xs font-medium text-indigo-700 underline dark:text-indigo-300"
                >
                  Click end date on calendar →
                </button>
              </div>

              <label className="block text-sm font-medium">
                Holiday Name
                <input
                  className={field}
                  placeholder="e.g. Eid-ul-Fitr Vacation, Summer Vacation…"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium">
                  Start Date
                  <input
                    type="date"
                    className={field}
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value);
                      if (end < e.target.value) setEnd(e.target.value);
                    }}
                    required
                  />
                </label>
                <label className="block text-sm font-medium">
                  End Date
                  <input
                    type="date"
                    className={field}
                    value={end}
                    min={start || undefined}
                    onChange={(e) => setEnd(e.target.value)}
                    required
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-indigo-600"
                  checked={repeatYearly}
                  onChange={(e) => setRepeatYearly(e.target.checked)}
                />
                Save as Yearly Variable Holiday (repeats every year with new dates)
              </label>
            </>
          )}
        </div>
      )}

      {/* TAB 2 & TAB 3 SHARED DEPARTMENT / BATCH PICKER */}
      {(tab === 'dept-break' || tab === 'sem-break') && (
        <div className="space-y-2.5">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Select Department(s)
              </span>
              <button
                type="button"
                onClick={() =>
                  setPickedDepts(
                    pickedDepts.size === structure.departments.length
                      ? new Set()
                      : new Set(structure.departments.map((d) => d.id)),
                  )
                }
                className="text-xs text-indigo-700 underline dark:text-indigo-300"
              >
                {pickedDepts.size === structure.departments.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {structure.departments.map((d) => {
                const on = pickedDepts.has(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleDept(d.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      on
                        ? 'bg-indigo-600 text-white'
                        : 'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
                    }`}
                  >
                    {d.code}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Batch:</span>
            <button
              type="button"
              onClick={() => setPickedBatch('all')}
              className={`rounded px-2 py-1 font-semibold ${
                pickedBatch === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
              }`}
            >
              All Batches
            </button>
            {intakeYears.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setPickedBatch(y)}
                className={`rounded px-2 py-1 font-semibold ${
                  pickedBatch === y
                    ? 'bg-indigo-600 text-white'
                    : 'border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                }`}
              >
                {String(y % 100).padStart(2, '0')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: MID BREAK / UNOFFICIAL BREAK */}
      {tab === 'dept-break' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setBreakCategory('MID_BREAK')}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                breakCategory === 'MID_BREAK'
                  ? 'bg-orange-600 text-white'
                  : 'border border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200'
              }`}
            >
              Mid Break
            </button>
            <button
              type="button"
              onClick={() => setBreakCategory('UNOFFICIAL_BREAK')}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                breakCategory === 'UNOFFICIAL_BREAK'
                  ? 'bg-zinc-700 text-white dark:bg-zinc-200 dark:text-zinc-900'
                  : 'border border-zinc-300 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
              }`}
            >
              Unofficial Break
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Start Date
              <input
                type="date"
                className={field}
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (end < e.target.value) setEnd(e.target.value);
                }}
                required
              />
            </label>
            <label className="block text-sm font-medium">
              End Date
              <input
                type="date"
                className={field}
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-zinc-500">Quick duration:</span>
            {[1, 2, 3].map((wks) => (
              <button
                key={wks}
                type="button"
                onClick={() => {
                  const sat = weekStartOf(start);
                  setStart(sat);
                  setEnd(addDays(sat, (wks - 1) * 7 + 4));
                }}
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {wks} {wks === 1 ? 'week' : 'weeks'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: SEMESTER BREAK (Day after last exam -> weekend of that week) */}
      {tab === 'sem-break' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Last Exam Date
              <input
                type="date"
                className={field}
                value={lastExamDate}
                onChange={(e) => {
                  const d = e.target.value;
                  setLastExamDate(d);
                  if (d) setSemBreakEnd(computeSemesterBreakRange(d).end);
                }}
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Break Ends (Weekend)
              <input
                type="date"
                className={field}
                value={semBreakEnd}
                min={semBreakStart}
                onChange={(e) => setSemBreakEnd(e.target.value)}
                required
              />
            </label>
          </div>

          <div className="rounded-md border border-teal-300 bg-teal-50 px-3 py-2 text-xs text-teal-950 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-100">
            Semester Break will run from <strong>{longDate(semBreakStart)}</strong> (day after last
            exam) to <strong>{longDate(semBreakEnd)}</strong>.
          </div>
        </div>
      )}

      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Note (optional)
        <input
          className={field}
          placeholder="Optional note…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {error && (
        <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      <button type="submit" disabled={saving} className={`${primary} w-full py-2`}>
        {saving
          ? 'Saving…'
          : tab === 'common'
            ? commonKind === 'fixed'
              ? 'Save Yearly Fixed Holiday'
              : 'Save Common Holiday'
            : tab === 'dept-break'
              ? `Save ${breakCategory === 'MID_BREAK' ? 'Mid Break' : 'Unofficial Break'}`
              : 'Save Semester Break'}
      </button>
    </form>
  );
}

const FIELDS = ['title', 'note', 'startDate', 'endDate', 'classesOnly'] as const;
const FIELD_LABEL: Record<string, string> = {
  title: 'title',
  note: 'note',
  startDate: 'start date',
  endDate: 'end date',
  classesOnly: 'classes off only',
};

function describe(e: AuditEntry): string {
  if (e.action !== 'UPDATE') {
    return {
      CREATE: 'Created',
      DELETE: 'Deleted',
      RESTORE: 'Restored',
      UPDATE: '',
    }[e.action];
  }
  const b = e.before ?? {};
  const a = e.after ?? {};
  const changed = FIELDS.filter((f) => b[f] !== a[f]).map((f) => FIELD_LABEL[f]!);
  if (JSON.stringify(b.audience) !== JSON.stringify(a.audience)) changed.push('who is off');
  return `Changed: ${changed.join(', ') || 'details'}`;
}

function HistorySheet({
  holiday,
  onClose,
}: {
  holiday: { id: number; title: string };
  onClose: () => void;
}) {
  const [res, setRes] = useState<{ entries?: AuditEntry[]; error?: string } | null>(null);
  useEffect(() => {
    api<{ entries: AuditEntry[] }>(`/api/admin/audit?holidayId=${holiday.id}`).then((r) =>
      setRes(r.ok ? { entries: r.data.entries } : { error: r.message }),
    );
  }, [holiday.id]);

  return (
    <Sheet title={`History: ${holiday.title}`} onClose={onClose}>
      {!res ? (
        <p className="text-sm">Loading…</p>
      ) : res.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {res.error}
        </p>
      ) : (
        <ol className="space-y-2">
          {res.entries!.map((e) => {
            const overlaps = e.after?.confirmedOverlapWith as number[] | undefined;
            return (
              <li
                key={e.id}
                className="rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800"
              >
                <p className="font-medium">{describe(e)}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {e.admin.name} · {stamp(e.at)}
                </p>
                {overlaps && overlaps.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Saved despite overlap with: {overlaps.map((id) => `#${id}`).join(', ')}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Sheet>
  );
}
