'use client';
import { useState } from 'react';
import { bnDigits } from '@/core/journey/journey';
import type { ApiStructure } from '@/lib/api';
import { findSeries, headline, type StatusEntry } from '@/lib/journey-ui';
import { setMySeries, useMySeries } from '@/lib/my-series';
import { SeriesSheet } from './SeriesSheet';
import { Sheet } from './Sheet';
import { small } from './ui';

/**
 * "আমার সিরিজ": picks the visitor's department + intake (kept in this browser) and, once set,
 * shows the one-line status above both public tabs. `entry` is that series' state on `date`.
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
        <p className="min-w-0 flex-1 text-sm text-zinc-600 dark:text-zinc-400">
          {seriesId ? 'লোড হচ্ছে…' : 'আপনার সিরিজ বেছে নিলে এখানে সেমিস্টারের অবস্থা দেখাবে।'}
        </p>
      )}
      <button
        type="button"
        className={small}
        disabled={!structure}
        onClick={() => setPicking(true)}
      >
        {mine ? 'সিরিজ বদলান' : 'আমার সিরিজ'}
      </button>
      {picking && structure && (
        <PickerSheet structure={structure} onClose={() => setPicking(false)} />
      )}
      {open && seriesId && (
        <SeriesSheet seriesId={seriesId} date={date} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function PickerSheet({ structure, onClose }: { structure: ApiStructure; onClose: () => void }) {
  const mine = useMySeries();
  const [dept, setDept] = useState(mine?.dept ?? '');
  const d = structure.departments.find((x) => x.code === dept);
  const years = structure.series
    .filter((s) => s.departmentId === d?.id)
    .map((s) => s.intakeYear)
    .sort((a, b) => b - a);

  return (
    <Sheet title="আমার সিরিজ" onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-sm font-medium">
          ডিপার্টমেন্ট
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">বেছে নিন</option>
            {structure.departments.map((x) => (
              <option key={x.id} value={x.code}>
                {x.code}
              </option>
            ))}
          </select>
        </label>
        {d && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium">কোন সিরিজ?</legend>
            <div className="flex flex-wrap gap-2">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  aria-pressed={mine?.dept === dept && mine.year === y}
                  className={`${small} px-3 py-2 ${mine?.dept === dept && mine.year === y ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950' : ''}`}
                  onClick={() => {
                    setMySeries({ dept, year: y });
                    onClose();
                  }}
                >
                  {bnDigits(y)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {mine && (
          <button
            type="button"
            className="text-sm underline"
            onClick={() => {
              setMySeries(null);
              onClose();
            }}
          >
            আমার সিরিজ মুছে ফেলুন
          </button>
        )}
      </div>
    </Sheet>
  );
}
