'use client';
import type { ApiStructure } from '@/lib/api';
import { bn } from '@/lib/rule-summary';
import { AudiencePicker } from './AudiencePicker';
import { small } from './ui';

/**
 * Faculty > department > series tree (the audience picker), plus one-tap "every 2024 series"
 * chips, because at go-live whole intakes share the same state. `structure` should already
 * contain only the series that may be chosen.
 */
export function SeriesSelect({
  structure,
  selected,
  onChange,
  legend = 'কোন সিরিজ?',
}: {
  structure: ApiStructure;
  selected: Set<number>;
  onChange: (s: Set<number>) => void;
  legend?: string;
}) {
  const years = [...new Set(structure.series.map((s) => s.intakeYear))].sort((a, b) => b - a);
  const toggleYear = (y: number) => {
    const ids = structure.series.filter((s) => s.intakeYear === y).map((s) => s.id);
    const all = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    for (const id of ids) {
      if (all) next.delete(id);
      else next.add(id);
    }
    onChange(next);
  };

  if (structure.series.length === 0) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">নির্বাচন করার মতো সিরিজ নেই।</p>;
  }
  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="ভর্তির বছর অনুযায়ী নির্বাচন"
      >
        {years.map((y) => {
          const ids = structure.series.filter((s) => s.intakeYear === y).map((s) => s.id);
          const on = ids.every((id) => selected.has(id));
          return (
            <button
              key={y}
              type="button"
              aria-pressed={on}
              onClick={() => toggleYear(y)}
              className={`${small} ${on ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950' : ''}`}
            >
              সব {y}
            </button>
          );
        })}
        <button type="button" className={small} onClick={() => onChange(new Set())}>
          পরিষ্কার
        </button>
        <span className="ml-auto text-sm" aria-live="polite">
          {bn(selected.size)}টি নির্বাচিত
        </span>
      </div>
      <AudiencePicker
        structure={structure}
        selected={selected}
        onChange={onChange}
        legend={legend}
        allLabel="সব সিরিজ"
      />
    </div>
  );
}
