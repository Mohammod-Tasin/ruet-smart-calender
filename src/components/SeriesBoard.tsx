'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { audienceFromSeries } from '@/core/calendar/audience';
import { appliesToSeries } from '@/core/calendar/compress';
import { todayInDhaka } from '@/core/calendar/grid';
import { addDays } from '@/core/calendar/hijri';
import { monthShort } from '@/core/calendar/months';
import {
  DEFAULT_STRUCTURE,
  SEMESTERS,
  weekStartOf,
  type JPhase,
  type JourneyStructure,
} from '@/core/journey/journey';
import { fieldsFromStructure, sameFields, type ScheduleFields } from '@/core/journey/schedule';
import { api, clearHolidayCache, type ApiStructure, type PublicHoliday } from '@/lib/api';
import { useStatus, useStructure } from '@/lib/hooks';
import {
  cellText,
  dayText,
  headline,
  PHASE_LABEL,
  PHASE_STYLE,
  rangeText,
  semLabel,
  UNOFFICIAL_STRIP,
  type JourneyResponse,
  type StatusEntry,
} from '@/lib/journey-ui';
import { Sheet } from './Sheet';
import { StatusMatrix } from './StatusMatrix';
import { useToast } from './Toast';
import { primary, small } from './ui';

type Target =
  | { kind: 'series'; entry: StatusEntry }
  | { kind: 'intake'; year: number }
  | { kind: 'department'; deptId: number };

/** Series Board: tap any department, batch column, or individual cell to edit its status easily. */
export function SeriesBoard() {
  const params = useSearchParams();
  const { structure, failed } = useStructure();
  const today = useMemo(() => todayInDhaka(), []);
  const [date, setDate] = useState(today);
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useStatus(date, { bust: true, version });
  const [target, setTarget] = useState<Target | null>(null);
  const highlight = useMemo(
    () =>
      new Set(
        (params.get('highlight') ?? '')
          .split(',')
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    [params],
  );
  const [settings, setSettings] = useState<JourneyStructure>(DEFAULT_STRUCTURE);
  const bySeries = useMemo(() => new Map(data?.series.map((s) => [s.seriesId, s])), [data]);

  useEffect(() => {
    api<{ structure: JourneyStructure }>('/api/admin/academic-settings').then((r) => {
      if (r.ok) setSettings(r.data.structure);
    });
  }, []);

  const refresh = () => {
    clearHolidayCache();
    setVersion((v) => v + 1);
  };

  if (error || failed) {
    return (
      <p role="alert" className="px-1 text-sm text-red-700 dark:text-red-400">
        Could not load the board.{' '}
        <button type="button" className="underline" onClick={() => setVersion((v) => v + 1)}>
          Try again
        </button>
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          {highlight.size > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Highlighted boxes still need a status.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="board-date-input" className="mb-1 block text-xs font-medium">
              Viewing week of
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="board-date-input"
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="button"
                onClick={() => setDate(addDays(date, -7))}
                aria-label="Previous week"
                title="Previous week (-1 week)"
                className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setDate(addDays(date, 7))}
                aria-label="Next week"
                title="Next week (+1 week)"
                className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
          <span className="pb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-hidden>
            {dayText(date)}
          </span>
          {date !== today && (
            <button
              type="button"
              onClick={() => setDate(today)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Quick Department Selector Bar */}
      {structure && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/70 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
          <span className="mr-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Quick Edit Dept:
          </span>
          {structure.departments.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setTarget({ kind: 'department', deptId: d.id })}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-zinc-800 hover:border-indigo-400 hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-indigo-950"
            >
              {d.code}
            </button>
          ))}
        </div>
      )}

      {structure ? (
        <StatusMatrix
          structure={structure}
          bySeries={bySeries}
          loading={loading}
          onCell={(entry) => setTarget({ kind: 'series', entry })}
          onColumn={(year) => setTarget({ kind: 'intake', year })}
          onDepartment={(deptId) => setTarget({ kind: 'department', deptId })}
          highlight={highlight}
        />
      ) : (
        <p className="px-1 text-sm">Loading…</p>
      )}

      {target && target.kind === 'department' && structure && (
        <DepartmentSheet
          key={`dept-${target.deptId}`}
          deptId={target.deptId}
          structure={structure}
          bySeries={bySeries}
          date={date}
          onClose={() => setTarget(null)}
          onSelectSeries={(entry) => setTarget({ kind: 'series', entry })}
          onSaved={refresh}
        />
      )}

      {target && (target.kind === 'series' || target.kind === 'intake') && structure && (
        <WhereSheet
          key={target.kind === 'series' ? target.entry.seriesId : `y${target.year}`}
          structure={structure}
          settings={settings}
          bySeries={bySeries}
          target={target}
          date={date}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

const chipOn =
  'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 dark:border-indigo-500 dark:bg-indigo-600 dark:text-white';

const STAGE_CHIP_STYLE: Partial<Record<JPhase, { off: string; on: string }>> = {
  MID_BREAK: {
    off: 'border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200 dark:hover:bg-orange-900/70',
    on: 'border-orange-600 bg-orange-600 text-white hover:bg-orange-700 dark:border-orange-500 dark:bg-orange-600 dark:text-white',
  },
  SEMESTER_BREAK: {
    off: 'border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200 dark:hover:bg-orange-900/70',
    on: 'border-orange-600 bg-orange-600 text-white hover:bg-orange-700 dark:border-orange-500 dark:bg-orange-600 dark:text-white',
  },
  VIVA: {
    off: 'border-purple-300 bg-purple-50 text-purple-900 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-200 dark:hover:bg-purple-900/70',
    on: 'border-purple-600 bg-purple-600 text-white hover:bg-purple-700 dark:border-purple-500 dark:bg-purple-600 dark:text-white',
  },
  EXAM: {
    off: 'border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200 dark:hover:bg-blue-900/70',
    on: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:text-white',
  },
};

/** Helper to save an Unofficial Break for a set of seriesIds, clearing any conflicting POSITION on that exact week. */
async function saveUnofficialBreakForSeries({
  seriesIds,
  structure,
  weekStart,
  anchorPos,
}: {
  seriesIds: number[];
  structure: ApiStructure;
  weekStart: string;
  anchorPos?: { semesterNo: number; phase: JPhase; weekNo: number; asOfDate: string };
}) {
  const startDate = addDays(weekStart, -2);
  const endDate = addDays(weekStart, 6);
  const audience = audienceFromSeries(new Set(seriesIds), structure);

  if (anchorPos) {
    const pr = await api('/api/admin/positions/bulk', {
      method: 'POST',
      body: {
        seriesIds,
        kind: 'POSITION',
        asOfDate: anchorPos.asOfDate,
        semesterNo: anchorPos.semesterNo,
        phase: anchorPos.phase,
        weekNo: anchorPos.weekNo,
      },
    });
    if (!pr.ok) return { ok: false as const, message: pr.message };
  }

  for (const id of seriesIds) {
    const jr = await api<JourneyResponse>(`/api/series/${id}/journey?_=${Date.now()}`);
    if (!jr.ok) continue;
    const onBreakWeek = jr.data.positions.find(
      (p) => p.kind === 'POSITION' && weekStartOf(p.asOfDate) === weekStart,
    );
    if (onBreakWeek) {
      const prevWeek = addDays(weekStart, -7);
      const hasEarlier = jr.data.positions.some((p) => weekStartOf(p.asOfDate) < weekStart);
      if (!hasEarlier && !anchorPos) {
        await api('/api/admin/positions/bulk', {
          method: 'POST',
          body: {
            seriesIds: [id],
            kind: 'POSITION',
            asOfDate: prevWeek,
            semesterNo: onBreakWeek.semesterNo,
            phase: onBreakWeek.phase,
            weekNo: onBreakWeek.weekNo,
          },
        });
      }
      await api(`/api/admin/positions/${onBreakWeek.id}`, { method: 'DELETE' });
    }
  }

  const hr = await api('/api/admin/holidays', {
    method: 'POST',
    body: {
      title: 'Unofficial Break',
      category: 'UNOFFICIAL_BREAK',
      classesOnly: true,
      startDate,
      endDate,
      audience,
      confirmOverlap: true,
      confirmPast: true,
    },
  });
  if (!hr.ok) return { ok: false as const, message: hr.message };
  return { ok: true as const, range: rangeText(startDate, endDate) };
}

/**
 * Department Editor Sheet: opened when clicking a department name (e.g. `ME ▸`).
 * Shows every batch of that department with 1-click controls (`-1 wk`, `+1 wk`, `+ Auto next wk`, `Edit`),
 * plus a whole-department Unofficial Break action at the bottom.
 */
function DepartmentSheet({
  deptId,
  structure,
  bySeries,
  date,
  onClose,
  onSelectSeries,
  onSaved,
}: {
  deptId: number;
  structure: ApiStructure;
  bySeries: Map<number, StatusEntry>;
  date: string;
  onClose: () => void;
  onSelectSeries: (entry: StatusEntry) => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<number | 'all' | null>(null);
  const dept = structure.departments.find((d) => d.id === deptId);
  const seriesList = useMemo(
    () =>
      structure.series
        .filter((s) => s.departmentId === deptId)
        .sort((a, b) => a.intakeYear - b.intakeYear)
        .flatMap((s) => {
          const entry = bySeries.get(s.id);
          return entry ? [entry] : [];
        }),
    [structure, deptId, bySeries],
  );

  const thisSat = useMemo(() => weekStartOf(date), [date]);
  const thisWed = useMemo(() => addDays(thisSat, 4), [thisSat]);
  const nextSat = useMemo(() => addDays(thisSat, 7), [thisSat]);
  const nextWed = useMemo(() => addDays(nextSat, 4), [nextSat]);

  async function nudgeWeek(e: StatusEntry, delta: number) {
    const s = e.state;
    if (s.status !== 'RUNNING' || !s.semesterNo || !s.phase) return;
    const nextW = Math.max(1, (s.weekNo ?? 1) + delta);
    setBusyId(e.seriesId);
    const r = await api('/api/admin/positions/bulk', {
      method: 'POST',
      body: {
        seriesIds: [e.seriesId],
        kind: 'POSITION',
        asOfDate: date,
        semesterNo: s.semesterNo,
        phase: s.phase,
        weekNo: nextW,
      },
    });
    setBusyId(null);
    if (!r.ok) return toast(r.message, 'error');
    toast(`${e.series} updated to ${PHASE_LABEL[s.phase]} week ${nextW}.`);
    onSaved();
  }

  async function autoForSeries(e: StatusEntry, when: 'this' | 'next') {
    setBusyId(e.seriesId);
    const s = e.state;
    const weekStart = when === 'this' ? thisSat : nextSat;
    const anchorPos =
      when === 'next' && s.status === 'RUNNING' && s.semesterNo && s.phase && s.weekNo && !s.onSkippedWeek
        ? {
            semesterNo: s.semesterNo,
            phase: s.phase,
            weekNo: s.weekNo,
            asOfDate: thisSat,
          }
        : undefined;
    const res = await saveUnofficialBreakForSeries({
      seriesIds: [e.seriesId],
      structure,
      weekStart,
      anchorPos,
    });
    setBusyId(null);
    if (!res.ok) return toast(res.message, 'error');
    toast(`Unofficial Break added for ${e.series} (${res.range}).`);
    onSaved();
  }

  async function autoForAllDept(when: 'this' | 'next') {
    if (seriesList.length === 0) return;
    setBusyId('all');
    const weekStart = when === 'this' ? thisSat : nextSat;
    const res = await saveUnofficialBreakForSeries({
      seriesIds: seriesList.map((x) => x.seriesId),
      structure,
      weekStart,
    });
    setBusyId(null);
    if (!res.ok) return toast(res.message, 'error');
    toast(`Unofficial Break added for all ${dept?.code ?? 'department'} batches (${res.range}).`);
    onSaved();
  }

  return (
    <Sheet
      title={dept ? `${dept.code} — ${dept.name}` : 'Department'}
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Status on <strong>{dayText(date)}</strong>. Click <strong>Edit</strong> on any batch to
          change its semester, stage, or week.
        </p>

        {/* Each Series in the Department */}
        <div className="space-y-2.5">
          {seriesList.map((e) => {
            const s = e.state;
            const running = s.status === 'RUNNING' && s.phase;
            const badgeStyle = !running
              ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
              : s.onSkippedWeek
                ? s.onUnofficialBreak
                  ? UNOFFICIAL_STRIP
                  : 'bg-rose-500 text-white'
                : PHASE_STYLE[s.phase!].cell;

            return (
              <div
                key={e.seriesId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="min-w-[9rem]">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold">{e.series}</span>
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${badgeStyle}`}>
                      {cellText(s)}
                    </span>
                    {running && s.semesterLabel && (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium dark:bg-zinc-800">
                        Sem {s.semesterLabel}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{headline(e)}</p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {running && !s.onSkippedWeek && (s.phase === 'CLASS' || s.phase === 'EXAM') && (
                    <>
                      <button
                        type="button"
                        disabled={busyId !== null || (s.weekNo ?? 1) <= 1}
                        onClick={() => nudgeWeek(e, -1)}
                        title="Decrease week by 1"
                        className={small}
                      >
                        −1 wk
                      </button>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => nudgeWeek(e, 1)}
                        title="Increase week by 1"
                        className={small}
                      >
                        +1 wk
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => autoForSeries(e, 'next')}
                    className={small}
                  >
                    + Auto next wk
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSeries(e)}
                    className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Whole Department Quick Auto at bottom */}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            All {dept?.code} Batches ({seriesList.map((s) => s.series).join(', ')})
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => autoForAllDept('next')}
              className={small}
            >
              + Auto next week for all {dept?.code} ({rangeText(nextSat, nextWed)})
            </button>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => autoForAllDept('this')}
              className={small}
            >
              + Auto this week for all {dept?.code} ({rangeText(thisSat, thisWed)})
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Unified stage/week button item:
 * 1..midAfter, Mid (Mid-term break), (midAfter+1)..totalClasses (e.g. 8..13, 14, 15...), Viva, E1..E5
 */
interface TimelineItem {
  key: string;
  label: string;
  phase: JPhase;
  weekNo: number;
}

function buildTimelineItems(midAfter: number, totalClasses: number): TimelineItem[] {
  const clampedMid = Math.min(Math.max(1, midAfter), totalClasses);
  const beforeCount = clampedMid;
  const afterCount = Math.max(0, totalClasses - clampedMid);
  return [
    ...Array.from({ length: beforeCount }, (_, i) => ({
      key: `C${i + 1}`,
      label: String(i + 1),
      phase: 'CLASS' as JPhase,
      weekNo: i + 1,
    })),
    { key: 'MID', label: 'Mid', phase: 'MID_BREAK' as JPhase, weekNo: 1 },
    ...Array.from({ length: afterCount }, (_, i) => ({
      key: `C${clampedMid + i + 1}`,
      label: String(clampedMid + i + 1),
      phase: 'CLASS' as JPhase,
      weekNo: clampedMid + i + 1,
    })),
    { key: 'VIVA', label: 'Viva', phase: 'VIVA' as JPhase, weekNo: 1 },
    ...Array.from({ length: 5 }, (_, i) => ({
      key: `E${i + 1}`,
      label: `E${i + 1}`,
      phase: 'EXAM' as JPhase,
      weekNo: i + 1,
    })),
  ];
}

type TimelineEntry =
  | { kind: 'item'; item: TimelineItem; date: string }
  | { kind: 'holiday'; weekStart: string; date: string; title: string; isUnofficial?: boolean };

const MIN_CLASS_WEEKS = 1;
const MAX_CLASS_WEEKS = 20;

/**
 * Single-screen, user-friendly editor for one series (e.g. `ME-22`) or a whole intake (`22`).
 * 1. Semester (1-1..4-2)
 * 2. Unified timeline buttons: 1..midAfter, Mid, (midAfter+1)..totalClasses, Viva, E1..E5
 * 3. Customize semester:
 *    - Mid break after --- week
 *    - Unofficial break after --- week (can be > 1 week)
 *    - Extend semester (each week adds after 13: 14, 15, ...)
 */
function WhereSheet({
  structure,
  settings,
  bySeries,
  target,
  date,
  onClose,
  onSaved,
}: {
  structure: ApiStructure;
  settings: JourneyStructure;
  bySeries: Map<number, StatusEntry>;
  target: Extract<Target, { kind: 'series' } | { kind: 'intake' }>;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const nextSat = useMemo(() => addDays(weekStartOf(date), 7), [date]);

  const baseFields = useMemo(
    () => fieldsFromStructure(settings) ?? fieldsFromStructure(DEFAULT_STRUCTURE)!,
    [settings],
  );
  const defaultMidAfter = Math.max(1, baseFields.classesBefore);
  const defaultTotalClasses = Math.max(1, baseFields.classesBefore + baseFields.classesAfter);

  const now = target.kind === 'series' ? target.entry.state : null;
  const running = now?.status === 'RUNNING';
  const [sem, setSem] = useState<number | null>(running ? now.semesterNo : 1);
  const [phase, setPhase] = useState<JPhase | null>(running && now.phase ? now.phase : 'CLASS');
  const [week, setWeek] = useState<number | null>(running && now.weekNo ? now.weekNo : 1);
  const [saving, setSaving] = useState(false);

  // 3. Customize semester states
  const [semSchedules, setSemSchedules] = useState<Map<number, ScheduleFields>>(new Map());
  const [dirtyCustom, setDirtyCustom] = useState(false);
  const [midAfter, setMidAfter] = useState<number>(defaultMidAfter);
  const [totalClasses, setTotalClasses] = useState<number>(() => {
    const curClass = running && now?.phase === 'CLASS' && now.weekNo ? now.weekNo : 0;
    return Math.max(defaultTotalClasses, curClass);
  });
  interface UnofficialBreakItem {
    afterWeek: number;
    weeks: number;
  }
  const [unofficialBreaks, setUnofficialBreaks] = useState<UnofficialBreakItem[]>([]);

  // Load any saved per-semester custom schedule (Mid break position / Extended weeks) for a single series
  useEffect(() => {
    if (target.kind !== 'series') return;
    let live = true;
    api<JourneyResponse>(
      `/api/series/${target.entry.seriesId}/journey?date=${date}&_=${Date.now()}`,
    ).then((r) => {
      if (!live || !r.ok) return;
      const map = new Map<number, ScheduleFields>();
      for (const s of r.data.schedules) {
        if (s.fields) map.set(s.semesterNo, s.fields);
      }
      setSemSchedules(map);
      if (!dirtyCustom && sem !== null) {
        const f = map.get(sem) ?? baseFields;
        const tot = Math.max(1, f.classesBefore + f.classesAfter);
        setTotalClasses(tot);
        setMidAfter(Math.min(Math.max(1, f.classesBefore), tot));
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, date, baseFields]);

  function selectSemester(n: number) {
    setSem(n);
    setDirtyCustom(false);
    const f = semSchedules.get(n) ?? baseFields;
    const tot = Math.max(1, f.classesBefore + f.classesAfter);
    setTotalClasses(tot);
    setMidAfter(Math.min(Math.max(1, f.classesBefore), tot));
    setUnofficialBreaks([]);
    if (phase === 'CLASS' && (week ?? 1) > tot) {
      setWeek(tot);
    }
  }

  function extendByOneWeek() {
    if (totalClasses >= MAX_CLASS_WEEKS) return;
    setDirtyCustom(true);
    setTotalClasses((t) => Math.min(MAX_CLASS_WEEKS, t + 1));
  }

  function reduceByOneWeek() {
    if (totalClasses <= MIN_CLASS_WEEKS) return;
    const nextTotal = totalClasses - 1;
    setDirtyCustom(true);
    setTotalClasses(nextTotal);
    if (midAfter > nextTotal) setMidAfter(nextTotal);
    setUnofficialBreaks((prev) =>
      prev
        .filter((b) => b.afterWeek <= nextTotal)
        .map((b) => ({ ...b, afterWeek: Math.min(b.afterWeek, nextTotal) })),
    );
    if (phase === 'CLASS' && (week ?? 1) > nextTotal) setWeek(nextTotal);
  }

  const timelineItems = useMemo(
    () => buildTimelineItems(midAfter, totalClasses),
    [midAfter, totalClasses],
  );

  const vivaWeeks = Math.max(
    1,
    (target.kind === 'series' && sem !== null ? semSchedules.get(sem) : undefined)?.vivaWeeks ??
      baseFields.vivaWeeks,
  );

  // Holidays around `date` for the (first) chosen series: a week whose working days (Sat–Wed) are
  // all holidays is skipped, so the semester shifts by one week there.
  const holidaySeriesId =
    target.kind === 'series'
      ? target.entry.seriesId
      : (structure.series.find((s) => s.intakeYear === target.year)?.id ?? null);
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  useEffect(() => {
    if (holidaySeriesId === null) return;
    let live = true;
    api<{ holidays: PublicHoliday[] }>(
      `/api/holidays?from=${addDays(date, -196)}&to=${addDays(date, 196)}&_=${Date.now()}`,
    ).then((r) => {
      if (!live || !r.ok) return;
      setHolidays(
        r.data.holidays.filter(
          (h) =>
            h.category !== 'MID_BREAK' &&
            h.category !== 'SEMESTER_BREAK' &&
            appliesToSeries(h.audience, structure, holidaySeriesId),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [date, structure, holidaySeriesId]);

  /**
   * The timeline with dates, anchored so the selected button falls in the current week.
   * Class / Mid / Viva -> Saturday (week start). Exams: E1 Wed, E2 Tue, E3 Mon, E4 Sun, E5 Sat of
   * consecutive exam weeks. Holiday weeks (fully off) are inserted where they shift the semester.
   */
  const timeline = useMemo((): TimelineEntry[] | null => {
    type Slot = { item: TimelineItem | null; breakTitle?: string };
    const slots: Slot[] = [];
    for (const it of timelineItems) {
      slots.push({ item: it });
      if (it.phase === 'VIVA') {
        for (let i = 1; i < vivaWeeks; i++) slots.push({ item: null });
      }
      if (it.phase === 'CLASS') {
        const matchingBreaks = unofficialBreaks.filter((b) => b.afterWeek === it.weekNo);
        for (const b of matchingBreaks) {
          for (let i = 0; i < b.weeks; i++) {
            slots.push({ item: null, breakTitle: 'Unofficial Break' });
          }
        }
      }
    }
    const anchor = slots.findIndex(
      (s) => s.item && s.item.phase === phase && s.item.weekNo === (week ?? 1),
    );
    if (anchor < 0) return null;

    const WEEKLY_OFF = [4, 5];
    const holidayWeek = (w: string): { title: string; isUnofficial: boolean } | null => {
      const days = Array.from({ length: 7 }, (_, i) => addDays(w, i)).filter(
        (d) => !WEEKLY_OFF.includes(new Date(`${d}T00:00:00Z`).getUTCDay()),
      );
      const count = new Map<string, number>();
      let unofficialCount = 0;
      for (const d of days) {
        const on = holidays.filter((h) => h.startDate <= d && d <= h.endDate);
        if (on.length === 0) return null;
        if (on.some((h) => h.category === 'UNOFFICIAL_BREAK')) unofficialCount++;
        for (const h of on) count.set(h.title, (count.get(h.title) ?? 0) + 1);
      }
      const title = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Holiday';
      return { title, isUnofficial: unofficialCount === days.length };
    };

    const toEntry = (s: Slot, w: string): TimelineEntry | null => {
      if (s.breakTitle) {
        return { kind: 'holiday', weekStart: w, date: addDays(w, -2), title: s.breakTitle, isUnofficial: true };
      }
      if (!s.item) return null;
      let date = w;
      if (s.item.phase === 'EXAM') {
        date = addDays(w, 5 - s.item.weekNo);
      } else if (s.item.phase === 'MID_BREAK') {
        date = addDays(w, -2);
      }
      return { kind: 'item', item: s.item, date };
    };

    const anchorWeek = weekStartOf(date);
    const after: TimelineEntry[] = [];
    let w = anchorWeek;
    for (let k = anchor + 1; k < slots.length; k++) {
      w = addDays(w, 7);
      for (let guard = 0; guard < 12; guard++) {
        const res = holidayWeek(w);
        if (!res) break;
        after.push({ kind: 'holiday', weekStart: w, date: addDays(w, -2), title: res.title, isUnofficial: res.isUnofficial });
        w = addDays(w, 7);
      }
      const e = toEntry(slots[k]!, w);
      if (e) after.push(e);
    }
    const before: TimelineEntry[] = [];
    w = anchorWeek;
    for (let k = anchor - 1; k >= 0; k--) {
      w = addDays(w, -7);
      for (let guard = 0; guard < 12; guard++) {
        const res = holidayWeek(w);
        if (!res) break;
        before.push({ kind: 'holiday', weekStart: w, date: addDays(w, -2), title: res.title, isUnofficial: res.isUnofficial });
        w = addDays(w, -7);
      }
      const e = toEntry(slots[k]!, w);
      if (e) before.push(e);
    }
    const self = toEntry(slots[anchor]!, anchorWeek);
    return [...before.reverse(), ...(self ? [self] : []), ...after];
  }, [timelineItems, vivaWeeks, unofficialBreaks, phase, week, date, holidays]);

  // Consecutive entries grouped by the month of their date.
  const monthGroups = useMemo(() => {
    const entries: TimelineEntry[] =
      timeline ?? timelineItems.map((item) => ({ kind: 'item' as const, item, date: '' }));
    const groups: { month: string; entries: TimelineEntry[] }[] = [];
    for (const e of entries) {
      const month = e.date ? `${monthShort(e.date)} ${e.date.slice(0, 4)}` : '';
      const last = groups[groups.length - 1];
      if (last && last.month === month) last.entries.push(e);
      else groups.push({ month, entries: [e] });
    }
    return groups;
  }, [timeline, timelineItems]);

  const all = useMemo(
    () =>
      target.kind === 'series'
        ? [target.entry]
        : structure.series
            .filter((s) => s.intakeYear === target.year)
            .flatMap((s) => bySeries.get(s.id) ?? []),
    [target, structure, bySeries],
  );
  const [off, setOff] = useState<Set<number>>(new Set());
  const chosen = all.filter((e) => !off.has(e.seriesId));

  const weekNo = week ?? 1;
  const ready = sem !== null && phase !== null && weekNo !== null && chosen.length > 0;
  const who = chosen.length === 1 ? chosen[0]!.series : `${chosen.length} series`;
  const title =
    target.kind === 'series'
      ? `Edit ${target.entry.series}`
      : `Edit Batch ${target.year}`;
  const stageText = phase
    ? phase === 'CLASS'
      ? `Class week ${weekNo}`
      : phase === 'EXAM'
        ? `Semester Final week ${weekNo} (E${weekNo})`
        : PHASE_LABEL[phase]
    : '';

  async function save() {
    if (!ready || !sem || !phase) return;
    setSaving(true);
    const seriesIds = chosen.map((e) => e.seriesId);

    const existingFields =
      target.kind === 'series' ? (semSchedules.get(sem) ?? baseFields) : baseFields;
    const existingTotal = existingFields.classesBefore + existingFields.classesAfter;
    const clampedMid = Math.min(Math.max(1, midAfter), totalClasses);
    const desiredFields: ScheduleFields = {
      classesBefore: clampedMid,
      classesAfter: Math.max(0, totalClasses - clampedMid),
      vivaWeeks: existingFields.vivaWeeks,
      finalWeeks:
        phase === 'EXAM' && weekNo > existingFields.finalWeeks
          ? weekNo
          : existingFields.finalWeeks,
    };

    const needScheduleSave = !sameFields(desiredFields, existingFields);
    const shrinking = totalClasses < existingTotal;

    // Avoid re-pinning `date` if the user opened an already-running series solely to add an Unofficial Break
    const unchangedStage =
      target.kind === 'series' &&
      running &&
      sem === now?.semesterNo &&
      phase === now?.phase &&
      weekNo === now?.weekNo;
    const needPositionSave = !(unchangedStage && unofficialBreaks.length > 0 && !shrinking);

    // 1. If extending or changing mid-break without shrinking, update schedule BEFORE saving position (so week 14+ is valid)
    if (needScheduleSave && !shrinking) {
      const sr = await api('/api/admin/schedules', {
        method: 'POST',
        body: { seriesIds, semesterNo: sem, fields: desiredFields },
      });
      if (!sr.ok) {
        setSaving(false);
        return toast(sr.message, 'error');
      }
    }

    // 2. Save position
    if (needPositionSave) {
      const pr = await api('/api/admin/positions/bulk', {
        method: 'POST',
        body: {
          seriesIds,
          kind: 'POSITION',
          asOfDate: date,
          semesterNo: sem,
          phase,
          weekNo,
        },
      });
      if (!pr.ok) {
        setSaving(false);
        return toast(pr.message, 'error');
      }
    }

    // 3. If shrinking class weeks (e.g. 15 -> 14), update schedule AFTER position was moved down from 15
    if (needScheduleSave && shrinking) {
      const sr = await api('/api/admin/schedules', {
        method: 'POST',
        body: { seriesIds, semesterNo: sem, fields: desiredFields },
      });
      if (!sr.ok) {
        setSaving(false);
        return toast(sr.message, 'error');
      }
    }

    // 4. Save Unofficial break(s) if selected
    if (unofficialBreaks.length > 0) {
      const sortedBreaks = [...unofficialBreaks].sort((a, b) => a.afterWeek - b.afterWeek);
      for (const brk of sortedBreaks) {
        const jr = await api<JourneyResponse>(
          `/api/series/${seriesIds[0]}/journey?date=${date}&_=${Date.now()}`,
        );
        if (!jr.ok) {
          setSaving(false);
          return toast(jr.message, 'error');
        }

        const idx = jr.data.weeks.findIndex(
          (w) =>
            w.semesterNo === sem &&
            w.status === 'COUNTED' &&
            w.phase === 'CLASS' &&
            w.weekNo === brk.afterWeek,
        );

        let breakStartSat = nextSat;
        if (idx >= 0) {
          const classWeekRow = jr.data.weeks[idx]!;
          const nextExtendable = jr.data.weeks
            .slice(idx + 1)
            .find(
              (w) =>
                w.status === 'COUNTED' &&
                (w.phase === 'CLASS' || w.phase === 'VIVA' || w.phase === 'EXAM'),
            );
          breakStartSat = nextExtendable
            ? nextExtendable.weekStart
            : addDays(classWeekRow.weekStart, 7);
        }

        const breakStartThu = addDays(breakStartSat, -2);
        const breakEndSat = addDays(breakStartSat, (brk.weeks - 1) * 7);
        const breakEndDate = addDays(breakEndSat, 6);

        // Clear any conflicting POSITION rows pinned inside [breakStartSat, breakEndSat]
        for (const id of seriesIds) {
          const sj =
            id === seriesIds[0]
              ? jr
              : await api<JourneyResponse>(`/api/series/${id}/journey?date=${date}&_=${Date.now()}`);
          if (!sj.ok) continue;
          const conflicting = sj.data.positions.filter((p) => {
            if (p.kind !== 'POSITION') return false;
            const ws = weekStartOf(p.asOfDate);
            return ws >= breakStartSat && ws <= breakEndSat;
          });
          if (conflicting.length > 0) {
            const hasOutside = sj.data.positions.some((p) => {
              const ws = weekStartOf(p.asOfDate);
              return ws < breakStartSat || ws > breakEndSat;
            });
            if (!hasOutside && idx >= 0) {
              const cw = jr.data.weeks[idx]!;
              await api('/api/admin/positions/bulk', {
                method: 'POST',
                body: {
                  seriesIds: [id],
                  kind: 'POSITION',
                  asOfDate: cw.weekStart,
                  semesterNo: sem,
                  phase: 'CLASS',
                  weekNo: brk.afterWeek,
                },
              });
            }
            for (const c of conflicting) {
              await api(`/api/admin/positions/${c.id}`, { method: 'DELETE' });
            }
          }
        }

        const audience = audienceFromSeries(new Set(seriesIds), structure);
        const hr = await api('/api/admin/holidays', {
          method: 'POST',
          body: {
            title: 'Unofficial Break',
            category: 'UNOFFICIAL_BREAK',
            classesOnly: true,
            startDate: breakStartThu,
            endDate: breakEndDate,
            audience,
            confirmOverlap: true,
            confirmPast: true,
          },
        });
        if (!hr.ok) {
          setSaving(false);
          return toast(hr.message, 'error');
        }
      }

      setSaving(false);
      const summary = sortedBreaks
        .map((b) => `week ${b.afterWeek} (${b.weeks}w)`)
        .join(', ');
      toast(`Saved for ${who} + Unofficial Break after ${summary}.`);
      onSaved();
      return;
    }

    setSaving(false);
    toast(`Status saved for ${who}.`);
    onSaved();
  }

  const extendedWeeks =
    totalClasses > defaultTotalClasses
      ? Array.from(
          { length: totalClasses - defaultTotalClasses },
          (_, i) => defaultTotalClasses + i + 1,
        )
      : [];

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="space-y-4">
        {target.kind === 'series' && (
          <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            Current ({dayText(date)}): <strong>{headline(target.entry)}</strong>
          </div>
        )}

        <Group label="1. Semester">
          {Array.from({ length: SEMESTERS }, (_, i) => i + 1).map((n) => (
            <Chip key={n} on={sem === n} onClick={() => selectSemester(n)}>
              {semLabel(n)}
            </Chip>
          ))}
        </Group>

        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">2. Which week / stage?</legend>
          {/* One wrapping row: a month can continue on the next line. A bar under the buttons
              joins each month; its name sits under its first button. */}
          <div className="flex flex-wrap items-start gap-y-2">
            {monthGroups.flatMap((g, gi) =>
              g.entries.map((entry, ei) => {
                const first = ei === 0;
                const last = ei === g.entries.length - 1;
                let chip: React.ReactNode;
                if (entry.kind === 'holiday') {
                  const isUnofficial = entry.isUnofficial;
                  chip = (
                    <span
                      title={
                        isUnofficial
                          ? 'Unofficial Break week: the semester shifts by 1 week'
                          : 'Holiday week: the semester shifts by 1 week'
                      }
                      className={`flex min-w-10 cursor-default flex-col items-center rounded-md border border-dashed px-2 py-1.5 text-sm leading-tight font-medium ${
                        isUnofficial
                          ? 'border-zinc-400 bg-zinc-200/80 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                          : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200'
                      }`}
                    >
                      <span aria-hidden>&nbsp;</span>
                      <span className="text-[10px] font-normal opacity-70">
                        {Number(entry.date.slice(8, 10))}
                      </span>
                    </span>
                  );
                } else {
                  const item = entry.item;
                  const selected = phase === item.phase && weekNo === item.weekNo;
                  const d = entry.date;
                  chip = (
                    <Chip
                      on={selected}
                      tone={STAGE_CHIP_STYLE[item.phase]}
                      onClick={() => {
                        setPhase(item.phase);
                        setWeek(item.weekNo);
                      }}
                    >
                      <span className="flex flex-col items-center leading-tight">
                        <span>{item.label}</span>
                        {d && (
                          <span className="text-[10px] font-normal opacity-70">
                            {Number(d.slice(8, 10))}
                          </span>
                        )}
                      </span>
                    </Chip>
                  );
                }
                return (
                  <div
                    key={entry.kind === 'holiday' ? `H${entry.weekStart}` : entry.item.key}
                    className={`flex flex-col ${first && gi > 0 ? 'ml-2.5' : ''}`}
                  >
                    <div className={`${first ? '' : 'pl-[3px]'} ${last ? '' : 'pr-[3px]'}`}>
                      {chip}
                    </div>
                    {g.month && (
                      <>
                        <div
                          className={`mt-1 h-0.5 ${first ? 'rounded-l' : ''} ${last ? 'rounded-r' : ''} ${
                            gi % 2 ? 'bg-indigo-300 dark:bg-indigo-700' : 'bg-zinc-300 dark:bg-zinc-600'
                          }`}
                        />
                        <span className="relative h-4">
                          {first && (
                            <span className="absolute left-0 text-[11px] font-medium whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                              {gi === 0 || g.month.startsWith('Jan') ? g.month : g.month.slice(0, 3)}
                            </span>
                          )}
                        </span>
                      </>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        </fieldset>

        {target.kind === 'intake' && (
          <Group label="Apply to departments (tap to unselect a department)">
            {all.map((e) => {
              const included = !off.has(e.seriesId);
              return (
                <Chip
                  key={e.seriesId}
                  on={included}
                  onClick={() =>
                    setOff((o) => {
                      const n = new Set(o);
                      if (n.has(e.seriesId)) n.delete(e.seriesId);
                      else n.add(e.seriesId);
                      return n;
                    })
                  }
                >
                  {e.series.split('-')[0]}
                </Chip>
              );
            })}
          </Group>
        )}

        {/* 3. Customize semester */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">3. Customize semester</h3>
          <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
            {/* 1st: Mid break after --- week */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Mid break after
              </span>
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={midAfter <= 1}
                  onClick={() => {
                    setDirtyCustom(true);
                    setMidAfter((m) => Math.max(1, m - 1));
                  }}
                  className={`${small} h-9 w-9 p-0 flex items-center justify-center font-bold text-zinc-700 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                  aria-label="Move Mid break earlier"
                >
                  &lt;
                </button>
                <div
                  className={`flex min-w-11 items-center justify-center rounded-md border px-3 py-1.5 text-sm font-semibold shadow-xs ${STAGE_CHIP_STYLE.MID_BREAK?.off ?? 'border-rose-300 bg-rose-50 text-rose-900'}`}
                >
                  <span className="flex flex-col items-center leading-tight">
                    <span>Week {midAfter}</span>
                  </span>
                </div>
                <button
                  type="button"
                  disabled={midAfter >= totalClasses}
                  onClick={() => {
                    setDirtyCustom(true);
                    setMidAfter((m) => Math.min(totalClasses, m + 1));
                  }}
                  className={`${small} h-9 w-9 p-0 flex items-center justify-center font-bold text-zinc-700 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                  aria-label="Move Mid break later"
                >
                  &gt;
                </button>
              </div>
            </div>

            {/* 2nd: Unofficial break after --- week (can have multiple breaks across the semester) */}
            <div className="border-t border-zinc-200 pt-2.5 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-700 dark:text-zinc-300 text-sm">
                  Unofficial breaks
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDirtyCustom(true);
                    setUnofficialBreaks((prev) => {
                      const nextWeek = Math.min(
                        totalClasses,
                        prev.length > 0 ? Math.min(totalClasses, prev[prev.length - 1]!.afterWeek + 2) : 2,
                      );
                      return [...prev, { afterWeek: nextWeek, weeks: 1 }];
                    });
                  }}
                  className={`${small} py-1 px-2.5 text-xs text-indigo-700 dark:text-indigo-300 font-semibold`}
                >
                  + Add break
                </button>
              </div>

              {unofficialBreaks.length === 0 ? (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  No unofficial breaks added for this semester. Click &quot;+ Add break&quot; to add one.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {unofficialBreaks.map((brk, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-white p-2 text-sm dark:border-zinc-800 dark:bg-zinc-800/80"
                    >
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                        After
                      </span>
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          disabled={brk.afterWeek <= 1}
                          onClick={() => {
                            setDirtyCustom(true);
                            setUnofficialBreaks((prev) =>
                              prev.map((b, i) =>
                                i === idx ? { ...b, afterWeek: Math.max(1, b.afterWeek - 1) } : b,
                              ),
                            );
                          }}
                          className={`${small} h-7 w-7 p-0 flex items-center justify-center font-bold text-zinc-700 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                          aria-label="Move break earlier"
                        >
                          &lt;
                        </button>
                        <div className="flex min-w-9 items-center justify-center rounded border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                          Week {brk.afterWeek}
                        </div>
                        <button
                          type="button"
                          disabled={brk.afterWeek >= totalClasses}
                          onClick={() => {
                            setDirtyCustom(true);
                            setUnofficialBreaks((prev) =>
                              prev.map((b, i) =>
                                i === idx ? { ...b, afterWeek: Math.min(totalClasses, b.afterWeek + 1) } : b,
                              ),
                            );
                          }}
                          className={`${small} h-7 w-7 p-0 flex items-center justify-center font-bold text-zinc-700 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                          aria-label="Move break later"
                        >
                          &gt;
                        </button>
                      </div>

                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium ml-1">
                        Duration:
                      </span>
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          disabled={brk.weeks <= 1}
                          onClick={() => {
                            setDirtyCustom(true);
                            setUnofficialBreaks((prev) =>
                              prev.map((b, i) =>
                                i === idx ? { ...b, weeks: Math.max(1, b.weeks - 1) } : b,
                              ),
                            );
                          }}
                          className={`${small} h-7 w-7 p-0 flex items-center justify-center font-bold text-zinc-700 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                          aria-label="Decrease break weeks"
                        >
                          &lt;
                        </button>
                        <div className="flex min-w-9 items-center justify-center rounded border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                          {brk.weeks} {brk.weeks === 1 ? 'wk' : 'wks'}
                        </div>
                        <button
                          type="button"
                          disabled={brk.weeks >= 8}
                          onClick={() => {
                            setDirtyCustom(true);
                            setUnofficialBreaks((prev) =>
                              prev.map((b, i) =>
                                i === idx ? { ...b, weeks: Math.min(8, b.weeks + 1) } : b,
                              ),
                            );
                          }}
                          className={`${small} h-7 w-7 p-0 flex items-center justify-center font-bold text-zinc-700 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                          aria-label="Increase break weeks"
                        >
                          &gt;
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setDirtyCustom(true);
                          setUnofficialBreaks((prev) => prev.filter((_, i) => i !== idx));
                        }}
                        className="ml-auto text-xs text-red-600 hover:text-red-700 dark:text-red-400 font-medium px-1.5 py-0.5"
                        title="Remove break"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {target.kind === 'series' && (
                <ActiveAutoBreaks
                  seriesId={target.entry.seriesId}
                  structure={structure}
                  date={date}
                  onChanged={onSaved}
                />
              )}
            </div>

            {/* 3rd: Extend / Reduce semester class weeks */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-2.5 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Semester duration
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  ({totalClasses} class weeks)
                </span>
                {totalClasses > defaultTotalClasses && (
                  <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                    Extended (+{totalClasses - defaultTotalClasses})
                  </span>
                )}
                {totalClasses < defaultTotalClasses && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    Reduced (-{defaultTotalClasses - totalClasses})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={totalClasses <= MIN_CLASS_WEEKS}
                  onClick={reduceByOneWeek}
                  className={`${small} bg-white px-2.5 py-1 text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700`}
                >
                  − Reduce ({totalClasses - 1})
                </button>
                <button
                  type="button"
                  disabled={totalClasses >= MAX_CLASS_WEEKS}
                  onClick={extendByOneWeek}
                  className={`${small} bg-white px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700`}
                >
                  {totalClasses >= MAX_CLASS_WEEKS
                    ? `Max (${MAX_CLASS_WEEKS})`
                    : `+ Add week ${totalClasses + 1}`}
                </button>
              </div>
            </div>
          </div>
        </section>

        {target.kind === 'series' && (
          <SavedPositions seriesId={target.entry.seriesId} onChanged={onSaved} />
        )}

        <div className="sticky bottom-0 -mx-4 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={!ready || saving} onClick={save}>
              {saving ? 'Saving…' : 'Save Status'}
            </button>
            <button type="button" className={`${small} px-4 py-2`} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/** Shows existing Unofficial Breaks for a series around `date`, with a 1-click Remove button. */
function ActiveAutoBreaks({
  seriesId,
  structure,
  date,
  onChanged,
}: {
  seriesId: number;
  structure: ApiStructure;
  date: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [breaks, setBreaks] = useState<PublicHoliday[]>([]);
  const [busyId, setBusyId] = useState<number | string | null>(null);

  useEffect(() => {
    let live = true;
    const from = addDays(date, -60);
    const to = addDays(date, 180);
    api<{ holidays: PublicHoliday[] }>(`/api/holidays?from=${from}&to=${to}&_=${Date.now()}`).then(
      (r) => {
        if (!live || !r.ok) return;
        setBreaks(
          r.data.holidays.filter(
            (h) =>
              typeof h.id === 'number' &&
              h.category === 'UNOFFICIAL_BREAK' &&
              appliesToSeries(h.audience, structure, seriesId),
          ),
        );
      },
    );
    return () => {
      live = false;
    };
  }, [seriesId, structure, date]);

  if (breaks.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 text-xs">
      {breaks.map((b) => (
        <div
          key={b.id}
          className="flex items-center justify-between gap-2 rounded bg-zinc-200/70 px-2 py-1 dark:bg-zinc-800"
        >
          <span>
            {b.title} ({rangeText(b.startDate, b.endDate)})
          </span>
          <button
            type="button"
            disabled={busyId === b.id}
            onClick={async () => {
              setBusyId(b.id);
              const r = await api(`/api/admin/holidays/${b.id}`, {
                method: 'DELETE',
                body: { confirmPast: true },
              });
              setBusyId(null);
              if (!r.ok) return toast(r.message, 'error');
              toast('Unofficial break removed.');
              onChanged();
            }}
            className="text-red-700 underline dark:text-red-400"
          >
            {busyId === b.id ? 'Removing…' : 'Remove'}
          </button>
        </div>
      ))}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function Chip({
  on,
  tone,
  onClick,
  children,
}: {
  on: boolean;
  tone?: { off: string; on: string };
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`${small} min-w-10 px-3 py-1.5 ${
        on ? (tone?.on ?? chipOn) : (tone?.off ?? '')
      }`}
    >
      {children}
    </button>
  );
}

/** The change history of one series' status; a wrong entry can be deleted here (the earliest one is the anchor). */
function SavedPositions({ seriesId, onChanged }: { seriesId: number; onChanged: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<JourneyResponse['positions'] | null>(null);
  const [schedules, setSchedules] = useState<JourneyResponse['schedules']>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    api<JourneyResponse>(`/api/series/${seriesId}/journey?_=${Date.now()}`).then((r) => {
      if (!live) return;
      setRows(r.ok ? r.data.positions : []);
      setSchedules(r.ok ? r.data.schedules.filter((x) => x.fields) : []);
    });
    return () => {
      live = false;
    };
  }, [seriesId, version]);

  if (!rows || rows.length + schedules.length === 0) return null;
  return (
    <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Saved position history ({rows.length + schedules.length})
      </summary>
      <ul className="space-y-1 px-3 pb-3 text-sm">
        {schedules.map((x) => (
          <li key={`s${x.semesterNo}`}>
            Semester {semLabel(x.semesterNo)} · different schedule: classes{' '}
            {x.fields!.classesBefore} + {x.fields!.classesAfter}, Board Viva {x.fields!.vivaWeeks},
            Final {x.fields!.finalWeeks}
          </li>
        ))}
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-2">
            <span>
              {dayText(p.asOfDate)} · {semLabel(p.semesterNo)} ·{' '}
              {p.kind === 'SEMESTER_START'
                ? 'Semester start day'
                : `${PHASE_LABEL[p.phase]}${p.weekNo > 1 || p.phase === 'CLASS' || p.phase === 'EXAM' ? ` week ${p.weekNo}` : ''}`}
            </span>
            <button
              type="button"
              className="ml-auto text-xs text-red-700 underline dark:text-red-400"
              onClick={async () => {
                const r = await api(`/api/admin/positions/${p.id}`, { method: 'DELETE' });
                if (!r.ok) return toast(r.message, 'error');
                toast('Deleted.');
                setVersion((v) => v + 1);
                onChanged();
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
