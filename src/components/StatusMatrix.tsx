'use client';
import type { ApiStructure } from '@/lib/api';
import { cellText, headline, NONE_CELL, PHASE_STYLE, type StatusEntry } from '@/lib/journey-ui';

const sticky = 'sticky left-0 z-10 bg-white dark:bg-zinc-950';

/**
 * Departments (grouped by faculty) down, intake years across. The first column sticks, so on a
 * 360px phone only the table scrolls sideways, never the page. With `onColumn` (admin) the
 * column header becomes a button for the whole intake.
 */
export function StatusMatrix({
  structure,
  bySeries,
  loading,
  onCell,
  onColumn,
  highlight,
}: {
  structure: ApiStructure;
  bySeries: Map<number, StatusEntry>;
  loading: boolean;
  onCell: (e: StatusEntry) => void;
  onColumn?: (year: number) => void;
  /** Series ids to draw attention to (the admin to-do "Set status" link). */
  highlight?: Set<number>;
}) {
  const years = [...new Set(structure.series.map((s) => s.intakeYear))].sort((a, b) => a - b);
  const groups = structure.faculties
    .map((f) => ({ f, depts: structure.departments.filter((d) => d.facultyId === f.id) }))
    .filter((g) => g.depts.length > 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full border-separate border-spacing-0 text-left" aria-busy={loading}>
        <caption className="sr-only">Semester status by department and batch</caption>
        <thead>
          <tr>
            <th scope="col" className={`${sticky} px-2 py-1.5 text-xs font-medium text-zinc-500`}>
              Department
            </th>
            {years.map((y) => (
              <th key={y} scope="col" className="min-w-[4.75rem] px-0.5 py-1 text-center">
                {onColumn ? (
                  <button
                    type="button"
                    onClick={() => onColumn(y)}
                    aria-label={`Set status for the whole ${y} batch`}
                    className="w-full rounded-md border border-indigo-300 bg-indigo-50 px-1 py-1 text-xs font-semibold text-indigo-900 hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100"
                  >
                    {String(y % 100)} ▾
                  </button>
                ) : (
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    <span className="sr-only">Batch {y} </span>
                    <span aria-hidden>{String(y % 100)}</span>
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map(({ f, depts }) => (
          <tbody key={f.id}>
            <tr>
              <th
                colSpan={years.length + 1}
                scope="colgroup"
                className="bg-zinc-50 px-2 py-1 text-xs font-semibold dark:bg-zinc-900"
              >
                <span className="sticky left-2">
                  {f.code} <span className="font-normal text-zinc-500">· {f.name}</span>
                </span>
              </th>
            </tr>
            {depts.map((d) => (
              <tr key={d.id}>
                <th scope="row" className={`${sticky} px-2 py-0.5 text-sm font-medium`}>
                  {d.code}
                </th>
                {years.map((y) => {
                  const s = structure.series.find(
                    (x) => x.departmentId === d.id && x.intakeYear === y,
                  );
                  const e = s && bySeries.get(s.id);
                  return (
                    <td key={y} className="p-0.5 align-top">
                      <Cell
                        entry={e}
                        exists={!!s}
                        loading={loading}
                        onOpen={onCell}
                        mark={!!s && !!highlight?.has(s.id)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Cell({
  entry,
  exists,
  loading,
  onOpen,
  mark,
}: {
  mark?: boolean;
  entry: StatusEntry | undefined;
  exists: boolean;
  loading: boolean;
  onOpen: (e: StatusEntry) => void;
}) {
  const box = 'flex h-11 w-full flex-col items-center justify-center rounded-md px-0.5 text-center';
  if (loading) return <div className={`${box} animate-pulse bg-zinc-100 dark:bg-zinc-900`} />;
  if (!exists || !entry) {
    return (
      <div className={`${box} ${NONE_CELL} text-xs`} aria-hidden>
        No data
      </div>
    );
  }
  const s = entry.state;
  const running = s.status === 'RUNNING' && s.phase;
  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      aria-label={headline(entry)}
      className={`${box} text-xs leading-tight focus-visible:outline-2 focus-visible:outline-indigo-500 ${
        mark ? 'ring-2 ring-amber-500' : ''
      } ${
        running ? PHASE_STYLE[s.phase!].cell : NONE_CELL
      } ${s.onSkippedWeek ? 'border border-dashed border-current' : ''}`}
    >
      <span className="font-semibold">{cellText(s)}</span>
      {running && s.semesterLabel && (
        <span className="text-[10px] opacity-80">{s.semesterLabel}</span>
      )}
    </button>
  );
}
