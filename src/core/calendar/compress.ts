import type { AudienceEntry, Structure } from './types';

const SEPARATOR = ' · ';

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Ids of the ACTIVE series a holiday audience applies to. Inactive series are ignored. */
export function coveredSeriesIds(audience: AudienceEntry[], structure: Structure): Set<number> {
  const facultyOfDept = new Map(structure.departments.map((d) => [d.id, d.facultyId]));
  const covered = new Set<number>();
  for (const s of structure.series) {
    if (!s.isActive) continue;
    const hit = audience.some((a) => {
      switch (a.scopeType) {
        case 'ALL':
          return true;
        case 'FACULTY':
          return facultyOfDept.get(s.departmentId) === a.scopeId;
        case 'DEPARTMENT':
          return s.departmentId === a.scopeId;
        case 'SERIES':
          return s.id === a.scopeId;
      }
    });
    if (hit) covered.add(s.id);
  }
  return covered;
}

export function appliesToSeries(
  audience: AudienceEntry[],
  structure: Structure,
  seriesId: number,
): boolean {
  return coveredSeriesIds(audience, structure).has(seriesId);
}

/**
 * Collapses an audience into a short label, bottom-up:
 * all active series of a department -> `CSE`; all departments of a faculty -> `ECE Faculty`;
 * everything -> `ALL`. Otherwise lists what is left, e.g. `CSE · EEE-22`.
 * Order: faculty sort_order, department code, intake year descending.
 */
export function compressAudience(audience: AudienceEntry[], structure: Structure): string {
  const covered = coveredSeriesIds(audience, structure);
  if (covered.size === 0) return '';

  const activeByDept = new Map<number, Structure['series']>();
  for (const s of structure.series) {
    if (!s.isActive) continue;
    const list = activeByDept.get(s.departmentId) ?? [];
    list.push(s);
    activeByDept.set(s.departmentId, list);
  }

  const faculties = [...structure.faculties].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
  );

  const parts: string[] = [];
  let facultiesConsidered = 0;
  let facultiesFull = 0;

  for (const f of faculties) {
    // Departments with no active series can never be "covered", so they are skipped.
    const depts = structure.departments
      .filter((d) => d.facultyId === f.id && activeByDept.has(d.id))
      .sort((a, b) => byText(a.code, b.code));
    if (depts.length === 0) continue;
    facultiesConsidered++;

    const fullDepts = depts.filter((d) => activeByDept.get(d.id)!.every((s) => covered.has(s.id)));
    if (fullDepts.length === depts.length) {
      facultiesFull++;
      parts.push(`${f.code} Faculty`);
      continue;
    }

    for (const d of depts) {
      const mine = activeByDept.get(d.id)!;
      if (fullDepts.includes(d)) {
        parts.push(d.code);
        continue;
      }
      mine
        .filter((s) => covered.has(s.id))
        .sort((a, b) => b.intakeYear - a.intakeYear)
        .forEach((s) => parts.push(`${d.code}-${String(s.intakeYear % 100).padStart(2, '0')}`));
    }
  }

  if (facultiesConsidered > 0 && facultiesFull === facultiesConsidered) return 'ALL';
  return parts.join(SEPARATOR);
}
