import { coveredSeriesIds } from './compress';
import type { AudienceEntry, Structure } from './types';

/**
 * Turns a set of selected ACTIVE series ids (what a checkbox tree produces) into the
 * shortest audience: ALL, else FACULTY / DEPARTMENT where everything below is selected,
 * else single SERIES entries.
 */
export function audienceFromSeries(selected: Set<number>, structure: Structure): AudienceEntry[] {
  const seriesOf = (deptId: number) =>
    structure.series.filter((s) => s.isActive && s.departmentId === deptId);
  const full = (ids: number[]) => ids.length > 0 && ids.every((id) => selected.has(id));

  const faculties = structure.faculties
    .map((f) => ({
      f,
      depts: structure.departments
        .filter((d) => d.facultyId === f.id && seriesOf(d.id).length > 0)
        .map((d) => ({ d, series: seriesOf(d.id) })),
    }))
    .filter((x) => x.depts.length > 0);

  const facultyFull = (x: (typeof faculties)[number]) =>
    x.depts.every((dp) => full(dp.series.map((s) => s.id)));

  if (faculties.length > 0 && faculties.every(facultyFull)) {
    return [{ scopeType: 'ALL', scopeId: null }];
  }
  const out: AudienceEntry[] = [];
  for (const x of faculties) {
    if (facultyFull(x)) {
      out.push({ scopeType: 'FACULTY', scopeId: x.f.id });
      continue;
    }
    for (const { d, series } of x.depts) {
      if (full(series.map((s) => s.id))) out.push({ scopeType: 'DEPARTMENT', scopeId: d.id });
      else
        for (const s of series) {
          if (selected.has(s.id)) out.push({ scopeType: 'SERIES', scopeId: s.id });
        }
    }
  }
  return out;
}

/** True when any active series of the department is covered by the audience. */
export function appliesToDepartment(
  audience: AudienceEntry[],
  structure: Structure,
  departmentId: number,
): boolean {
  const covered = coveredSeriesIds(audience, structure);
  return structure.series.some((s) => s.departmentId === departmentId && covered.has(s.id));
}
