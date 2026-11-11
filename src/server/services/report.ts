import 'server-only';
import { parseOffDays } from '@/core/calendar/grid';
import { buildReport } from '@/core/report/build';
import { reportWindows } from '@/core/report/windows';
import { getStructure } from '@/server/db/queries';
import { getOffDays } from './off-days';
import { academicBreaksInRange, seriesLabel, statusOn } from './journey';

/** The 3-week holiday & break report. Read-only: composes getOffDays + the journey engine. */
export async function holidayReport(from: string) {
  const [w1, , w3] = reportWindows(from);
  const range = { from: w1.start, to: w3.end };
  const [offDays, breaks, status, structure] = await Promise.all([
    getOffDays(range),
    academicBreaksInRange(range.from, range.to),
    statusOn(from),
    getStructure(),
  ]);
  const active = structure.series.filter((s) => s.isActive);
  return buildReport({
    from,
    holidays: offDays,
    breaks,
    series: active.map((s) => ({
      id: s.id,
      label: seriesLabel(structure, s.id),
      departmentId: s.departmentId,
      intakeYear: s.intakeYear,
    })),
    noStatus: status.series.filter((s) => s.state.status === 'NONE').map((s) => s.seriesId),
    weeklyOff: parseOffDays(process.env.WEEKLY_OFF_DAYS),
  });
}
