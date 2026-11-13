import 'server-only';
import { coveredSeriesIds } from '@/core/calendar/compress';
import { parseOffDays, todayInDhaka } from '@/core/calendar/grid';
import { isRealDate } from '@/core/validation/holidays-query';
import { buildReport } from '@/core/report/build';
import { monthWindows, reportWindows } from '@/core/report/windows';
import { getDepartmentStudentCount } from '@/core/report/students';
import { getStructure } from '@/server/db/queries';
import { getOffDays } from './off-days';
import {
  academicBreaksInRange,
  getFemaleStudentPercentage,
  seriesLabel,
  statusOn,
} from './journey';

/**
 * Holiday & break report. Supports monthly reporting (e.g. "2026-11") or 3-week window from a date.
 * Read-only: composes getOffDays + the journey engine.
 */
export async function holidayReport(
  fromOrMonth: string,
  options?: { mode?: 'month' | 'weeks'; from?: string; today?: string },
) {
  const isMonth = options?.mode === 'month' || /^\d{4}-(0[1-9]|1[0-2])$/.test(fromOrMonth);
  const today = options?.today ?? todayInDhaka();
  const selectedDate = options?.from ?? (isRealDate(fromOrMonth) ? fromOrMonth : undefined);

  if (isMonth) {
    const ym = fromOrMonth.slice(0, 7);
    const startDate =
      selectedDate && selectedDate.slice(0, 7) === ym
        ? selectedDate
        : today.slice(0, 7) === ym
          ? today
          : undefined;
    const windows = monthWindows(ym, startDate);
    const range = { from: windows[0]!.start, to: windows[windows.length - 1]!.end };
    const statusDate = selectedDate ?? (today.slice(0, 7) === ym ? today : range.from);
    const [offDays, breaks, status, structure, femaleStudentPercentage] = await Promise.all([
      getOffDays(range),
      academicBreaksInRange(range.from, range.to),
      statusDate ? statusOn(statusDate) : statusOn(range.from),
      getStructure(),
      getFemaleStudentPercentage(),
    ]);
    const deptMap = new Map(structure.departments.map((d) => [d.id, d]));
    const active = structure.series.filter((s) => s.isActive);
    const seriesList = active.map((s) => {
      const d = deptMap.get(s.departmentId);
      const studentCount =
        (d as { studentCount?: number })?.studentCount ??
        getDepartmentStudentCount(d?.code ?? '', 60);
      return {
        id: s.id,
        label: seriesLabel(structure, s.id),
        departmentId: s.departmentId,
        intakeYear: s.intakeYear,
        studentCount,
        brothersCount: s.brothersCount ?? 0,
      };
    });
    return buildReport({
      from: range.from,
      to: range.to,
      month: ym,
      downloadedAt: selectedDate ?? today,
      femaleStudentPercentage,
      holidays: offDays.map((d) => ({
        ...d,
        seriesIds: [...coveredSeriesIds(d.audience, structure)],
      })),
      breaks,
      series: seriesList,
      noStatus: status.series.filter((s) => s.state.status === 'NONE').map((s) => s.seriesId),
      statusSummary: status.summary,
      weeklyOff: parseOffDays(process.env.WEEKLY_OFF_DAYS),
    });
  }

  const [w1, , w3] = reportWindows(fromOrMonth);
  const range = { from: w1.start, to: w3.end };
  const [offDays, breaks, status, structure, femaleStudentPercentage] = await Promise.all([
    getOffDays(range),
    academicBreaksInRange(range.from, range.to),
    statusOn(fromOrMonth),
    getStructure(),
    getFemaleStudentPercentage(),
  ]);
  const deptMap = new Map(structure.departments.map((d) => [d.id, d]));
  const active = structure.series.filter((s) => s.isActive);
  const seriesList = active.map((s) => {
    const d = deptMap.get(s.departmentId);
    const studentCount =
      (d as { studentCount?: number })?.studentCount ??
      getDepartmentStudentCount(d?.code ?? '', 60);
    return {
      id: s.id,
      label: seriesLabel(structure, s.id),
      departmentId: s.departmentId,
      intakeYear: s.intakeYear,
      studentCount,
      brothersCount: s.brothersCount ?? 0,
    };
  });
  return buildReport({
    from: fromOrMonth,
    downloadedAt: selectedDate ?? today,
    femaleStudentPercentage,
    holidays: offDays.map((d) => ({
      ...d,
      seriesIds: [...coveredSeriesIds(d.audience, structure)],
    })),
    breaks,
    series: seriesList,
    noStatus: status.series.filter((s) => s.state.status === 'NONE').map((s) => s.seriesId),
    statusSummary: status.summary,
    weeklyOff: parseOffDays(process.env.WEEKLY_OFF_DAYS),
  });
}
