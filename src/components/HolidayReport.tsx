'use client';
import { useState } from 'react';
import type { HolidayReport } from '@/core/report/build';
import { weekShort } from '@/core/report/pdf-model';
import { reportWindows } from '@/core/report/windows';
import { api } from '@/lib/api';
import { downloadReportPdf } from '@/lib/report-pdf';

/** "Holiday report" card on the Status page: one button that downloads the 3-week PDF. */
export function HolidayReportCard({ from }: { from: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const w = reportWindows(from);

  const generate = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const r = await api<HolidayReport>(`/api/report/holidays?from=${from}`);
      if (!r.ok) throw new Error(r.message);
      await downloadReportPdf(r.data, `ruet-holidays-${r.data.from}-to-${r.data.to}.pdf`);
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
      <p className="text-sm font-medium">Holiday report</p>
      <p className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">
        Download a PDF of all holidays and breaks for the next 3 weeks (
        {weekShort(w[0].start, w[2].end)}): a short summary, then week-by-week details.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={generate}
        className="mt-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? 'Preparing…' : 'Generate PDF'}
      </button>
      {failed && (
        <p role="alert" className="mt-1.5 text-xs text-red-700 dark:text-red-300">
          Could not make the PDF. Please try again.
        </p>
      )}
    </section>
  );
}
