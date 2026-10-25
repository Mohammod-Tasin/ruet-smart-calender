'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { nextLineBn, stateLineBn, type StatusEntry, type StatusResponse } from '@/lib/semester-ui';
import { TimelineDrawer } from './TimelineDrawer';

/**
 * "CSE-23 · ক্লাস সপ্তাহ ৫/১৩ · মিড ব্রেক ২৮ নভেম্বর" above the calendar when it is filtered to
 * one series. Outside the grid: day cells only ever show holidays.
 */
export function SeriesStateLine({ seriesId, today }: { seriesId: number; today: string }) {
  const [entry, setEntry] = useState<StatusEntry | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    api<StatusResponse>(`/api/status?date=${today}`).then((r) => {
      if (live)
        setEntry(r.ok ? (r.data.series.find((s) => s.seriesId === seriesId) ?? null) : null);
    });
    return () => {
      live = false;
    };
  }, [seriesId, today]);

  if (!entry) return null; // loading, failed, or no active semester: show nothing
  const next = nextLineBn(entry.state);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-zinc-800 dark:hover:bg-zinc-900"
        aria-label={`${entry.series}: ${stateLineBn(entry.state)}${next ? `. পরবর্তী ${next}` : ''}. সময়রেখা দেখুন`}
      >
        <span className="font-semibold">{entry.series}</span> · {stateLineBn(entry.state)}
        {next && <> · {next}</>}
      </button>
      {open && (
        <TimelineDrawer semesterId={entry.semesterId} date={today} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
