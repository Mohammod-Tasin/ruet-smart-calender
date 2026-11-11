import type { CSSProperties } from 'react';
import { type HolidayReport, type ReportCategory } from '@/core/report/build';
import { buildPdfModel, type PdfEntry, type PdfSummaryLine } from '@/core/report/pdf-model';

// Print layout for the PDF (A4 portrait): title, summary, details. Everything is inline-styled
// with hex colours: html2canvas cannot parse Tailwind's lab() colours, and the page CSS is
// dropped when rendering. Holiday, suspension and unofficial colours match the app calendar
// (src/lib/categories.ts); mid-term and semester break use the Status page's stage colours.

/** 190 mm printable width at 96 dpi. */
export const PRINT_WIDTH = 718;
// Equal side padding keeps content off the page edge. html2canvas draws it ~2px too far right
// (measured), so the left padding is smaller.
const SIDE = 6;
const SHIFT = 2;

const DOT: Record<ReportCategory, string> = {
  HOLIDAY: '#dc2626',
  MID_BREAK: '#f97316', // orange-500
  SEMESTER_BREAK: '#e11d48', // rose-600
  SUSPENDED_WEEK: '#64748b',
  UNOFFICIAL_BREAK: '#d4d4d8',
};
const GREY = '#52525b';

const dot = (c: ReportCategory, size = 10): CSSProperties => ({
  display: 'inline-block',
  width: size,
  height: size,
  borderRadius: size / 2,
  background: DOT[c],
  marginRight: 8,
  verticalAlign: 'middle',
});

function SummaryWeek({ line }: { line: PdfSummaryLine }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="pdf-avoid" data-keep-next="1" style={{ fontSize: 15, fontWeight: 700 }}>
        {line.week}
      </div>
      {line.parts.length === 0 ? (
        <div className="pdf-avoid" style={{ padding: '3px 0', fontSize: 13, color: GREY }}>
          No breaks
        </div>
      ) : (
        line.parts.map((p) => (
          <div
            key={p.label}
            className="pdf-avoid"
            style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 13 }}
          >
            <div style={{ width: 150, flexShrink: 0 }}>
              <span style={dot(p.category, 9)} />
              {p.label}
            </div>
            <div style={{ flex: 1 }}>{p.who}</div>
          </div>
        ))
      )}
    </div>
  );
}

function Entry({ e }: { e: PdfEntry }) {
  return (
    <div className="pdf-avoid" style={{ padding: '6px 0' }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>
        <span style={dot(e.category)} />
        {e.text}
      </div>
      {e.sub && <div style={{ fontSize: 13, color: GREY, marginLeft: 18 }}>{e.sub}</div>}
      {e.resume && <div style={{ fontSize: 13, color: '#166534', marginLeft: 18 }}>{e.resume}</div>}
    </div>
  );
}

export function PrintLayout({ r }: { r: HolidayReport }) {
  const m = buildPdfModel(r);
  return (
    <div style={{ padding: `0 ${SIDE + SHIFT}px 0 ${SIDE - SHIFT}px` }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{m.title}</h1>

      {/* Summary: who is off, per week and type */}
      {m.summary.map((l) => (
        <SummaryWeek key={l.week} line={l} />
      ))}

      {/* Details: plain sentences, one section per week */}
      {m.weeks.map((w) => (
        <div key={w.heading} style={{ marginTop: 22 }}>
          <h2
            className="pdf-avoid"
            data-keep-next="1"
            style={{
              fontSize: 18,
              fontWeight: 700,
              margin: 0,
              paddingBottom: 3,
              borderBottom: '1px solid #d4d4d8',
            }}
          >
            {w.heading}
          </h2>
          {w.entries.length === 0 ? (
            <div className="pdf-avoid" style={{ padding: '6px 0', fontSize: 14, color: GREY }}>
              No holidays or breaks.
            </div>
          ) : (
            w.entries.map((e, i) => <Entry key={i} e={e} />)
          )}
        </div>
      ))}
      <div
        className="pdf-avoid"
        style={{ marginTop: 18, fontSize: 12, color: GREY, paddingBottom: 24 }}
      >
        {m.noStatus.length > 0 && (
          <div>Series with no status are not included: {m.noStatus.join(', ')}.</div>
        )}
        <div>Dates marked &ldquo;expected&rdquo; depend on moon sighting.</div>
      </div>
    </div>
  );
}
