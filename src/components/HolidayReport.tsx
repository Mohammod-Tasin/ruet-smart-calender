'use client';
import { useState } from 'react';
import { parseMonthKey, shiftMonth } from '@/core/calendar/grid';
import type { HolidayReport } from '@/core/report/build';
import { api } from '@/lib/api';
import { monthTitle } from '@/lib/format';
import { downloadReportPdf } from '@/lib/report-pdf';

/** Single button to download the monthly report PDF for the given date. */
export function GenerateReportButton({ date }: { date: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const month = date.slice(0, 7);

  const generate = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const r = await api<HolidayReport>(
        `/api/report/holidays?from=${date}&month=${month}&_t=${Date.now()}`,
      );
      if (!r.ok) throw new Error(r.message);
      const safeName = `Summary report - ${date}.pdf`;
      await downloadReportPdf(r.data, safeName);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={generate}
        aria-label="Generate report"
        title="Download monthly holiday & breaks PDF report"
        className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs sm:text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <span>{busy ? 'Preparing…' : 'Generate Report'}</span>
      </button>
      {failed && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          Failed. Try again.
        </span>
      )}
    </div>
  );
}

/** "Holiday report" card on the Status page: monthly PDF report with download date. */
export function HolidayReportCard({ from }: { from: string }) {
  const [month, setMonth] = useState(() => from.slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const parsed = parseMonthKey(month) ?? { year: 2026, month: 11 };
  const label = monthTitle(parsed.year, parsed.month);

  const generate = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const r = await api<HolidayReport>(`/api/report/holidays?from=${from}&month=${month}`);
      if (!r.ok) throw new Error(r.message);
      const safeName = `Summary report - ${from}.pdf`;
      await downloadReportPdf(r.data, safeName);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Holiday report"
      className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Monthly Holiday Report</p>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
            Download a PDF report of all holidays and breaks for <strong>{label}</strong>:
            summary and week-by-week details with download date.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            title="Previous month"
            aria-label="Previous month"
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="min-w-[120px] text-center text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {label}
          </span>
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            title="Next month"
            aria-label="Next month"
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={generate}
          className="rounded-md bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {busy ? 'Preparing…' : `Generate PDF for ${label}`}
        </button>
      </div>

      {failed && (
        <p role="alert" className="mt-1.5 text-xs text-red-700 dark:text-red-300">
          Could not make the PDF. Please try again.
        </p>
      )}
    </section>
  );
}
