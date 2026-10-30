'use client';
import { useEffect, useRef } from 'react';
import type { ApiStructure } from '@/lib/api';

function Check({
  checked,
  indeterminate = false,
  onChange,
  children,
  className = '',
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className={`inline-flex cursor-pointer items-center gap-1.5 ${className}`}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-indigo-600"
      />
      {children}
    </label>
  );
}

const state = (ids: number[], selected: Set<number>) => {
  const n = ids.filter((id) => selected.has(id)).length;
  return { checked: ids.length > 0 && n === ids.length, indeterminate: n > 0 && n < ids.length };
};

/**
 * ALL / faculty / department / series checkboxes. State is just the set of selected series ids:
 * a parent toggles every series below it, and shows "indeterminate" when only some are chosen.
 */
export function AudiencePicker({
  structure,
  selected,
  onChange,
  legend = 'Who is off?',
  allLabel = 'ALL (whole university)',
}: {
  structure: ApiStructure;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  legend?: string;
  allLabel?: string;
}) {
  const toggle = (ids: number[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };
  const seriesOf = (deptId: number) =>
    structure.series
      .filter((s) => s.departmentId === deptId)
      .sort((a, b) => b.intakeYear - a.intakeYear);
  const allIds = structure.series.map((s) => s.id);

  return (
    <fieldset className="space-y-3 text-sm">
      <legend className="mb-1 font-medium">{legend}</legend>
      <Check
        {...state(allIds, selected)}
        onChange={(on) => toggle(allIds, on)}
        className="font-semibold"
      >
        {allLabel}
      </Check>
      {structure.faculties.map((f) => {
        const depts = structure.departments.filter(
          (d) => d.facultyId === f.id && seriesOf(d.id).length,
        );
        if (depts.length === 0) return null;
        const facultyIds = depts.flatMap((d) => seriesOf(d.id).map((s) => s.id));
        return (
          <div
            key={f.id}
            className="space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
          >
            <Check
              {...state(facultyIds, selected)}
              onChange={(on) => toggle(facultyIds, on)}
              className="font-medium"
            >
              {f.code} <span className="font-normal text-zinc-500">· {f.name}</span>
            </Check>
            {depts.map((d) => {
              const list = seriesOf(d.id);
              const ids = list.map((s) => s.id);
              return (
                <div key={d.id} className="ml-5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Check
                    {...state(ids, selected)}
                    onChange={(on) => toggle(ids, on)}
                    className="w-16 font-medium"
                  >
                    {d.code}
                  </Check>
                  {list.map((s) => (
                    <Check
                      key={s.id}
                      checked={selected.has(s.id)}
                      onChange={(on) => toggle([s.id], on)}
                    >
                      {String(s.intakeYear % 100).padStart(2, '0')}
                    </Check>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </fieldset>
  );
}
