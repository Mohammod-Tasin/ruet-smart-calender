'use client';
import { useRef, useState } from 'react';
import type { HolidayReport, ReportCategory, ReportItem } from '@/core/report/build';
import { CATEGORY_STYLE } from '@/lib/categories';
import { useReport } from '@/lib/hooks';
import { rangeText } from '@/lib/journey-ui';
import { downloadReportPdf } from '@/lib/report-pdf';
import { PRINT_WIDTH, PrintLayout } from './ReportPrint';

const CAT_LABEL: Record<ReportCategory, string> = {
  HOLIDAY: 'Official holidays',
  SUSPENDED_WEEK: 'Class suspensions',
  UNOFFICIAL_BREAK: 'Unofficial breaks',
  MID_BREAK: 'Mid-term breaks',
  SEMESTER_BREAK: 'Semester breaks',
};
const EMPTY = 'No holidays or breaks this week.';

const details = (i: ReportItem) =>
  [
    i.who + (i.semesters ? ` (Semester ${i.semesters})` : ''),
    ...i.flags,
    i.expected ? 'Expected' : '',
    i.inclWeekend ? 'incl. weekend' : '',
  ].filter(Boolean);

const dotClass = (c: ReportCategory) => CATEGORY_STYLE[c].solid.split(' ')[0];

function Footer({ r }: { r: HolidayReport }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-xs text-zinc-600 dark:text-zinc-400">
      <li>Weekly holidays: {r.weeklyOff.join(' and ')}.</li>
      {r.noStatus.length > 0 && (
        <li>Series with no status are not included: {r.noStatus.join(', ')}.</li>
      )}
      <li>&ldquo;Expected&rdquo; dates depend on moon sighting.</li>
    </ul>
  );
}

/** The "Next 3 weeks" card on the Status page. */
export function NextThreeWeeks({ from }: { from: string }) {
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useReport(from, version);
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const generate = async () => {
    if (!data || !printRef.current) return;
    setBusy(true);
    setPdfError(false);
    try {
      await downloadReportPdf(printRef.current, `ruet-holidays-${data.from}-to-${data.to}.pdf`);
    } catch {
      setPdfError(true);
    } finally {
      setBusy(false);
    }
  };

  const week = data?.weeks[tab];
  return (
    <section
      aria-label="Next 3 weeks"
      className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Next 3 weeks</h2>
        <button
          type="button"
          disabled={!data || busy}
          onClick={generate}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? 'Preparing…' : 'Generate PDF'}
        </button>
      </div>
      {pdfError && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
          Could not make the PDF. Please try again.
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          Could not load the report.{' '}
          <button type="button" className="underline" onClick={() => setVersion((n) => n + 1)}>
            Try again
          </button>
        </p>
      ) : loading || !data || !week ? (
        <p className="mt-2 text-sm">Loading…</p>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">At a glance</caption>
              <thead>
                <tr className="text-zinc-600 dark:text-zinc-400">
                  <th className="py-1 pr-2 font-medium">At a glance</th>
                  {data.weeks.map((_, i) => (
                    <th key={i} className="px-1 py-1 text-center font-medium">
                      Week {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.glance.map((g) => (
                  <tr key={g.category} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 pr-2">
                      <span
                        className={`mr-1.5 inline-block h-2 w-2 rounded-full ${dotClass(g.category)}`}
                      />
                      {CAT_LABEL[g.category]}
                    </td>
                    {g.counts.map((n, i) => (
                      <td key={i} className="px-1 py-1 text-center tabular-nums">
                        {n || '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div role="tablist" aria-label="Week" className="mt-3 flex gap-1">
            {data.weeks.map((w, i) => (
              <button
                key={i}
                role="tab"
                type="button"
                aria-selected={tab === i}
                onClick={() => setTab(i)}
                className={`flex-1 rounded-md border px-1 py-1.5 text-xs font-medium ${
                  tab === i
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-300 dark:border-zinc-700'
                }`}
              >
                Week {i + 1}
                <span className="block font-normal opacity-80">{rangeText(w.start, w.end)}</span>
              </button>
            ))}
          </div>

          <ul role="tabpanel" className="mt-2 space-y-2">
            {week.items.length === 0 && (
              <li className="text-sm text-zinc-600 dark:text-zinc-400">{EMPTY}</li>
            )}
            {week.items.map((i) => (
              <li key={i.key} className="flex gap-2 text-sm">
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(i.category)}`}
                />
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {i.title}{' '}
                    <span className="font-normal text-zinc-600 dark:text-zinc-400">
                      · {rangeText(i.startDate, i.endDate)}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {details(i).join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Footer r={data} />
          </div>

          {/* Light print layout: rendered off-screen, turned into the PDF by the browser's own text rendering. */}
          <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0 }}>
            <div
              ref={printRef}
              style={{
                width: PRINT_WIDTH,
                background: '#fff',
                color: '#111',
                fontFamily: 'system-ui, "Noto Sans Bengali", sans-serif',
                fontSize: 12,
                lineHeight: 1.4,
                paddingBottom: 24,
              }}
            >
              <PrintLayout r={data} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
