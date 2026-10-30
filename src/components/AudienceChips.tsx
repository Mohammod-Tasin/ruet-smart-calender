'use client';
import { useState } from 'react';
import type { ApiStructure } from '@/lib/api';
import { AudiencePicker } from './AudiencePicker';
import { small } from './ui';

type Mode = 'ALL' | 'DEPT' | 'SERIES';

/** Which chip an existing selection belongs to (null = nothing chosen yet). */
function detect(selected: Set<number>, st: ApiStructure): Mode | null {
  if (selected.size === 0) return null;
  if (st.series.every((s) => selected.has(s.id))) return 'ALL';
  const aligned = st.departments.every((d) => {
    const ids = st.series.filter((s) => s.departmentId === d.id).map((s) => s.id);
    const n = ids.filter((id) => selected.has(id)).length;
    return n === 0 || n === ids.length;
  });
  return aligned ? 'DEPT' : 'SERIES';
}

/**
 * Who is off, in three taps: "Everyone", "Department ▾" (department chips) or "Series ▾" (the full
 * faculty > department > series tree, only when asked for). The value is still a set of series ids.
 */
export function AudienceChips({
  structure,
  selected,
  onChange,
}: {
  structure: ApiStructure;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(() => detect(selected, structure));
  const idsOf = (deptId: number) =>
    structure.series.filter((s) => s.departmentId === deptId).map((s) => s.id);
  const deptOn = (deptId: number) => {
    const ids = idsOf(deptId);
    return ids.length > 0 && ids.every((id) => selected.has(id));
  };

  const pick = (m: Mode) => {
    setMode(m);
    if (m === 'ALL') onChange(new Set(structure.series.map((s) => s.id)));
    // Department chips can only express whole departments: drop partial ones.
    if (m === 'DEPT') {
      onChange(
        new Set(structure.departments.filter((d) => deptOn(d.id)).flatMap((d) => idsOf(d.id))),
      );
    }
  };
  const toggleDept = (deptId: number) => {
    const next = new Set(selected);
    const on = deptOn(deptId);
    for (const id of idsOf(deptId)) {
      if (on) next.delete(id);
      else next.add(id);
    }
    onChange(next);
  };

  const chip = (m: Mode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => pick(m)}
      className={`${small} px-3 py-1.5 ${mode === m ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950' : ''}`}
    >
      {label}
    </button>
  );

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-medium">Who is off?</legend>
      <div className="flex flex-wrap gap-2">
        {chip('ALL', 'Everyone')}
        {chip('DEPT', 'Department ▾')}
        {chip('SERIES', 'Series ▾')}
      </div>
      {mode === 'DEPT' &&
        structure.faculties.map((f) => {
          const depts = structure.departments.filter(
            (d) => d.facultyId === f.id && idsOf(d.id).length > 0,
          );
          return depts.length ? (
            <div key={f.id} className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs font-medium text-zinc-500">F{f.code}</span>
              {depts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={deptOn(d.id)}
                  onClick={() => toggleDept(d.id)}
                  className={`${small} ${deptOn(d.id) ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950' : ''}`}
                >
                  {d.code}
                </button>
              ))}
            </div>
          ) : null;
        })}
      {mode === 'SERIES' && (
        <AudiencePicker
          structure={structure}
          selected={selected}
          onChange={onChange}
          legend="Pick series"
          allLabel="All series"
        />
      )}
    </fieldset>
  );
}
