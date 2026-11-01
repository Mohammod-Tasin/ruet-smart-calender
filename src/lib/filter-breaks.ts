import { appliesToSeries, coveredSeriesIds } from '@/core/calendar/compress';
import { addDays } from '@/core/calendar/hijri';
import { weekStartOf } from '@/core/journey/journey';
import type { Structure } from '@/core/calendar/types';
import type { PublicHoliday } from './api';
import { semLabel } from './journey-ui';
import type { AcademicBreakItem } from '@/server/services/journey';

export type CalendarScope = 'COMMON' | 'ALL_DEPTS' | 'DEPT' | 'SERIES';

export interface CalendarFilter {
  scope: CalendarScope;
  deptId?: number | null;
  deptCode?: string | null;
  seriesId?: number | null;
  batch?: number | null;
  showEverything: boolean;
}

const dayOfWeek = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 Sun … 4 Thu, 5 Fri, 6 Sat

/**
 * Display span of a break strip on the calendar (RUET weekend = Thu + Fri):
 * - Mid / Unofficial break: previous week's Thursday → Friday of the (last) break week.
 * - Semester break: its start (day after E5) → Friday of that week.
 * Other categories are returned unchanged. Idempotent.
 */
export function breakDisplaySpan<T extends { category: string; startDate: string; endDate: string }>(
  h: T,
): T {
  const fridayOf = (d: string) => addDays(weekStartOf(d), 6);
  if (h.category === 'MID_BREAK' || h.category === 'UNOFFICIAL_BREAK') {
    const wd = dayOfWeek(h.startDate);
    // Already starting on the weekend (Thu/Fri) before the break week → keep that weekend.
    const breakSat =
      wd === 4 || wd === 5 ? addDays(h.startDate, 6 - wd) : weekStartOf(h.startDate);
    const startDate = addDays(breakSat, -2);
    const endDate = fridayOf(h.endDate < breakSat ? breakSat : h.endDate);
    return { ...h, startDate, endDate };
  }
  if (h.category === 'SEMESTER_BREAK') {
    return { ...h, endDate: fridayOf(h.endDate) };
  }
  return h;
}

/** Common holidays apply to everyone (`ALL`) with standard holiday category. */
const BREAK_CATEGORIES = new Set([
  'MID_BREAK',
  'UNOFFICIAL_BREAK',
  'SEMESTER_BREAK',
  'EXAM',
  'CLASS',
]);

/** "CSE · EEE-22": whole departments collapse to their code, otherwise series labels. */
export function seriesGroupLabel(ids: Set<number>, structure: Structure): string {
  const parts: string[] = [];
  const depts = [...structure.departments].sort((a, b) => a.code.localeCompare(b.code));
  for (const d of depts) {
    const active = structure.series
      .filter((s) => s.isActive && s.departmentId === d.id)
      .sort((a, b) => a.intakeYear - b.intakeYear);
    const on = active.filter((s) => ids.has(s.id));
    if (on.length === 0) continue;
    if (on.length === active.length && active.length > 1) parts.push(d.code);
    else parts.push(...on.map((s) => `${d.code}-${String(s.intakeYear % 100).padStart(2, '0')}`));
  }
  return parts.join(' · ');
}

/** Formats exam strip title as e.g. "Final E1-CE-23 · EEE-23 · E2-CE-24" */
export function formatExamTitle(
  items: AcademicBreakItem[],
  structure: Structure,
  scope?: Set<number> | null,
): string {
  const filtered = scope ? items.filter((i) => scope.has(i.seriesId)) : items;
  if (filtered.length === 0) return 'Semester Final';

  const byWeek = new Map<number, Set<number>>();
  for (const item of filtered) {
    const w = item.weekNo ?? 1;
    const sids = byWeek.get(w) ?? new Set<number>();
    sids.add(item.seriesId);
    byWeek.set(w, sids);
  }

  const sortedWeeks = [...byWeek.keys()].sort((a, b) => a - b);
  const parts: string[] = [];
  for (const w of sortedWeeks) {
    const sids = byWeek.get(w)!;
    const label = seriesGroupLabel(sids, structure);
    parts.push(`E${w}-${label}`);
  }

  return `Final ${parts.join(' · ')}`;
}

/** Series the current filter is about, or null when it covers everyone. */
export function scopeSeriesIds(filter: CalendarFilter, structure: Structure): Set<number> | null {
  const active = structure.series.filter((s) => s.isActive);
  if (filter.scope === 'SERIES' && filter.seriesId) return new Set([filter.seriesId]);
  if (filter.scope === 'DEPT' && filter.deptId)
    return new Set(active.filter((s) => s.departmentId === filter.deptId).map((s) => s.id));
  if (filter.scope === 'ALL_DEPTS' && filter.batch)
    return new Set(active.filter((s) => s.intakeYear === filter.batch).map((s) => s.id));
  return null;
}

/**
 * Puts every break of the same kind on the same dates into ONE strip, whether it was
 * saved by the admin (often one per series) or worked out from semester status.
 * With a `scope` (e.g. BECM selected), strips only name the series inside that scope.
 * Non-break holidays pass through unchanged (apart from that narrowing).
 */
export function mergeSameBreaks(
  list: PublicHoliday[],
  structure: Structure,
  scope: Set<number> | null = null,
): PublicHoliday[] {
  const baseTitle = (t: string) => t.replace(/\s*\(Sem [^)]*\)\s*$/, '');
  const out: PublicHoliday[] = [];
  const groups = new Map<string, PublicHoliday[]>();
  for (const raw of list) {
    let h = raw;
    // Narrow "CSE-22 · BECM-22 · CE-22" down to "BECM-22" when only BECM is selected.
    if (scope && h.label !== 'ALL') {
      const covered = coveredSeriesIds(h.audience, structure);
      const inScope = new Set([...covered].filter((id) => scope.has(id)));
      if (inScope.size > 0 && inScope.size < covered.size) {
        h = {
          ...h,
          audience: [...inScope].map((id) => ({ scopeType: 'SERIES' as const, scopeId: id })),
          label: seriesGroupLabel(inScope, structure),
        };
      }
    }
    if (!BREAK_CATEGORIES.has(h.category) || h.label === 'ALL') {
      out.push(h);
      continue;
    }
    const key =
      h.category === 'CLASS' || h.category === 'EXAM'
        ? `${h.category}:${baseTitle(h.title)}:${h.startDate}:${h.endDate}`
        : `${h.category}:${h.startDate}:${h.endDate}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    const first = group[0]!;
    const ids = new Set<number>();
    for (const h of group) for (const id of coveredSeriesIds(h.audience, structure)) ids.add(id);
    const titles = [...new Set(group.map((h) => h.title))];
    const customNotes = [...new Set(group.map((h) => h.note).filter(Boolean))].join('\n');
    out.push({
      ...first,
      id: `merged:${first.category}:${first.title}:${first.startDate}:${first.endDate}`,
      title: titles.length === 1 ? first.title : baseTitle(first.title),
      note: customNotes || null,
      audience: [...ids].map((id) => ({ scopeType: 'SERIES' as const, scopeId: id })),
      label: seriesGroupLabel(ids, structure),
      tentative: group.every((h) => h.tentative),
    });
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Common holidays apply to everyone (`ALL`) with standard holiday category. */
export const isCommonHoliday = (h: PublicHoliday): boolean =>
  h.label === 'ALL' && h.category === 'HOLIDAY';

/** Check if holiday audience touches a department. */
export function appliesToDept(
  audience: PublicHoliday['audience'],
  structure: Structure,
  deptId: number,
): boolean {
  const covered = coveredSeriesIds(audience, structure);
  return structure.series.some((s) => s.isActive && s.departmentId === deptId && covered.has(s.id));
}

/**
 * Filter holidays according to the selected scope (Common, All Departments, Department, or Series).
 */
export function filterHolidays(
  holidays: PublicHoliday[],
  structure: Structure,
  filter: CalendarFilter,
): PublicHoliday[] {
  switch (filter.scope) {
    case 'COMMON':
      return holidays.filter(isCommonHoliday);
    case 'ALL_DEPTS':
      if (filter.batch) {
        return holidays.filter(
          (h) =>
            isCommonHoliday(h) ||
            structure.series.some(
              (s) =>
                s.isActive &&
                s.intakeYear === filter.batch &&
                coveredSeriesIds(h.audience, structure).has(s.id),
            ),
        );
      }
      return holidays;
    case 'DEPT':
      if (!filter.deptId) return holidays.filter(isCommonHoliday);
      return holidays.filter(
        (h) => isCommonHoliday(h) || appliesToDept(h.audience, structure, filter.deptId!),
      );
    case 'SERIES':
      if (!filter.seriesId) return holidays.filter(isCommonHoliday);
      return holidays.filter(
        (h) => isCommonHoliday(h) || appliesToSeries(h.audience, structure, filter.seriesId!),
      );
  }
}

/**
 * Filters academic breaks and merges series of the same department sharing the same
 * dates and break category into a SINGLE strip/line/row on the calendar.
 */
export function filterAndMergeBreaks(
  breaks: AcademicBreakItem[],
  explicitHolidays: PublicHoliday[],
  structure: Structure,
  filter: CalendarFilter,
): PublicHoliday[] {
  // If in default COMMON scope and Show Everything is off, don't show academic items
  if (filter.scope === 'COMMON' && !filter.showEverything) {
    return [];
  }

  // 1. Filter breaks by scope
  let candidate = breaks;
  if (filter.scope === 'SERIES' && filter.seriesId) {
    candidate = breaks.filter((b) => b.seriesId === filter.seriesId);
  } else if (filter.scope === 'DEPT' && filter.deptId) {
    candidate = breaks.filter((b) => b.departmentId === filter.deptId);
  } else if (filter.scope === 'ALL_DEPTS' && filter.batch) {
    candidate = breaks.filter((b) => b.intakeYear === filter.batch);
  }

  // 1b. If Show Everything is NOT checked: hide CLASS weeks (keep Mid, Semester, Unofficial breaks & Exam dates)
  if (!filter.showEverything) {
    candidate = candidate.filter((b) => b.category !== 'CLASS');
  }

  // 2. Remove breaks that are already explicitly covered in holidays
  const filtered = candidate.filter((b) => {
    return !explicitHolidays.some(
      (h) =>
        h.category === b.category &&
        h.startDate <= b.endDate &&
        h.endDate >= b.startDate &&
        appliesToSeries(h.audience, structure, b.seriesId),
    );
  });

  // 3. For single series view, return as individual items
  if (filter.scope === 'SERIES' && filter.seriesId) {
    return filtered.map((b) => ({
      id: `break:${b.id}`,
      title:
        b.category === 'EXAM'
          ? `Final E${b.weekNo ?? 1}-${b.series}`
          : `${b.title} (Sem ${semLabel(b.semesterNo)})`,
      note: null,
      category: b.category,
      classesOnly: true,
      startDate: b.startDate,
      endDate: b.endDate,
      audience: [{ scopeType: 'SERIES', scopeId: b.seriesId }],
      label: b.category === 'EXAM' ? 'ALL' : b.series,
      source: 'ONE_OFF' as const,
      tentative: b.tentative,
      updatedBy: { name: 'Semester Status' },
      updatedAt: b.startDate,
    }));
  }

  // 4. For ALL_DEPTS or DEPT: merge every series sharing the same event + dates into ONE strip.
  //    Strip text reads "<event> · EEE-22 · CE-21" (a whole department collapses to "CSE").
  //    For semester finals, reads "Final E1-CE-23 · EEE-23 · E2-CE-24".
  const groups = new Map<string, AcademicBreakItem[]>();
  for (const b of filtered) {
    const key =
      b.category === 'CLASS'
        ? `${b.category}:${b.title}:${b.startDate}:${b.endDate}`
        : b.category === 'EXAM'
          ? `${b.category}:${b.startDate}:${b.endDate}`
          : `${b.category}:${b.startDate}:${b.endDate}`;
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }

  const mergedBars: PublicHoliday[] = [];
  const scope = scopeSeriesIds(filter, structure);
  for (const group of groups.values()) {
    const first = group[0]!;
    const category = first.category;
    const startDate = first.startDate;
    const endDate = first.endDate;
    const seriesIds = [...new Set(group.map((g) => g.seriesId))];

    // Per department: "CSE" if all its active series are on this break, else "CSE-21 · CSE-22".
    const byDept = new Map<number, AcademicBreakItem[]>();
    for (const g of group) byDept.set(g.departmentId, [...(byDept.get(g.departmentId) ?? []), g]);
    const parts: string[] = [];
    for (const [deptId, items] of [...byDept.entries()].sort((a, b) =>
      a[1][0]!.deptCode.localeCompare(b[1][0]!.deptCode),
    )) {
      const ids = new Set(items.map((i) => i.seriesId));
      const active = structure.series.filter((s) => s.isActive && s.departmentId === deptId);
      const whole = active.length > 1 && active.every((s) => ids.has(s.id));
      if (whole) parts.push(items[0]!.deptCode);
      else
        parts.push(
          ...[...new Map(items.map((i) => [i.seriesId, i])).values()]
            .sort((a, b) => a.intakeYear - b.intakeYear)
            .map((i) => i.series),
        );
    }
    const label = category === 'EXAM' ? 'ALL' : parts.join(' · ');

    // Title: formatted exam title for finals; for breaks, include semester only when everyone in the strip is in the same semester
    const distinctSemesters = [...new Set(group.map((g) => g.semesterNo))];
    const title =
      category === 'EXAM'
        ? formatExamTitle(group, structure, scope)
        : distinctSemesters.length === 1
          ? `${first.title} (Sem ${semLabel(distinctSemesters[0]!)})`
          : first.title;

    const note =
      category === 'EXAM'
        ? `Final exams: ${group.map((g) => `E${g.weekNo ?? 1} for ${g.series} (Sem ${semLabel(g.semesterNo)})`).join(', ')}`
        : null;

    const id =
      category === 'CLASS'
        ? `break-merged:${category}:${first.title}:${startDate}:${endDate}`
        : `break-merged:${category}:${startDate}:${endDate}`;

    mergedBars.push({
      id,
      title,
      note,
      category,
      classesOnly: true,
      startDate,
      endDate,
      audience: seriesIds.map((id) => ({ scopeType: 'SERIES', scopeId: id })),
      label,
      source: 'ONE_OFF',
      tentative: group.some((g) => g.tentative),
      updatedBy: { name: 'Semester Status' },
      updatedAt: startDate,
    });
  }

  return mergedBars;
}

