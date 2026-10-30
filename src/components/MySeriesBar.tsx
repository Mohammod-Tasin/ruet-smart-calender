'use client';
import { useState } from 'react';
import type { ApiStructure } from '@/lib/api';
import { findSeries, headline, type StatusEntry } from '@/lib/journey-ui';
import { setMySeries, useMySeries } from '@/lib/my-series';
import { SeriesSheet } from './SeriesSheet';
import { Sheet } from './Sheet';
import { small } from './ui';

/**
 * "My series": the visitor's department + batch (kept in this browser). Before it is set, a small
 * card with two selects (picking the batch saves it, so the status is two taps away); after, a
 * one-line status strip above both public tabs with a "Change" button. `entry` is that series'
 * state on `date`.
 */
export function MySeriesBar({
  structure,
  entry,
  date,
}: {
  structure: ApiStructure | null;
  entry: StatusEntry | undefined;
  date: string;
}) {
  const mine = useMySeries();
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState(false);
  const seriesId = structure && mine ? findSeries(structure, mine.dept, mine.year)?.id : undefined;

  if (structure && !mine) {
    return (
      <section className="mx-1 space-y-2 rounded-lg border border-indigo-300 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-950">
        <p className="text-sm font-medium">
          Pick your series to see your holidays and semester status
        </p>
        <SeriesSelects structure={structure} />
      </section>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      {seriesId && entry ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-left text-sm font-medium text-indigo-950 hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-50 dark:hover:bg-indigo-900"
        >
          {headline(entry)}
        </button>
      ) : (
        <p className="min-w-0 flex-1 text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
      )}
      <button
        type="button"
        className={small}
        disabled={!structure}
        onClick={() => setPicking(true)}
      >
        Change
      </button>
      {picking && structure && (
        <Sheet title="My series" onClose={() => setPicking(false)}>
          <div className="space-y-4">
            <SeriesSelects structure={structure} onDone={() => setPicking(false)} />
            <button
              type="button"
              className="text-sm underline"
              onClick={() => {
                setMySeries(null);
                setPicking(false);
              }}
            >
              Forget my series
            </button>
          </div>
        </Sheet>
      )}
      {open && seriesId && (
        <SeriesSheet seriesId={seriesId} date={date} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

const selectClass =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';

/** Department select, then batch select; choosing the batch saves. */
function SeriesSelects({ structure, onDone }: { structure: ApiStructure; onDone?: () => void }) {
  const mine = useMySeries();
  const [dept, setDept] = useState(mine?.dept ?? '');
  const d = structure.departments.find((x) => x.code === dept);
  const years = structure.series
    .filter((s) => s.departmentId === d?.id)
    .map((s) => s.intakeYear)
    .sort((a, b) => a - b);

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-sm font-medium">
        Department
        <select value={dept} onChange={(e) => setDept(e.target.value)} className={selectClass}>
          <option value="">Choose</option>
          {structure.departments.map((x) => (
            <option key={x.id} value={x.code}>
              {x.code}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Batch
        <select
          disabled={!d}
          value={mine?.dept === dept ? (mine.year ?? '') : ''}
          onChange={(e) => {
            if (!e.target.value) return;
            setMySeries({ dept, year: Number(e.target.value) });
            onDone?.();
          }}
          className={selectClass}
        >
          <option value="">Choose</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
