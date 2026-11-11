import type { CSSProperties } from 'react';
import { type HolidayReport, type ReportCategory } from '@/core/report/build';
import { buildPdfModel, type PdfRow, type PdfTableRow } from '@/core/report/pdf-model';

// Print layout for the PDF (A4 landscape). Everything is inline-styled with hex colours:
// html2canvas cannot parse Tailwind's lab() colours, and the page CSS is dropped when rendering.
// Holiday, suspension and unofficial colours match the app calendar (src/lib/categories.ts);
// mid-term and semester break use the Status page's stage colours (PHASE_STYLE strip).

/** 277 mm printable width at 96 dpi. Page height at this width = PRINT_WIDTH * 186 / 277. */
export const PRINT_WIDTH = 1047;
const PAGE_H = Math.floor((PRINT_WIDTH * 186) / 277);

const COLOR: Record<ReportCategory, { bg: string; fg: string; label: string }> = {
  HOLIDAY: { bg: '#dc2626', fg: '#ffffff', label: 'Holiday' },
  MID_BREAK: { bg: '#f97316', fg: '#431407', label: 'Mid-term break' }, // orange-500
  SEMESTER_BREAK: { bg: '#e11d48', fg: '#ffffff', label: 'Semester break' }, // rose-600
  SUSPENDED_WEEK: { bg: '#64748b', fg: '#ffffff', label: 'Class suspension' },
  UNOFFICIAL_BREAK: { bg: '#d4d4d8', fg: '#18181b', label: 'Unofficial break' },
};
const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GREY = '#52525b';
const COLS = '2.2fr 1.5fr 1.7fr 1.1fr'; // Who | Type | Off | Back to class

const dot = (c: ReportCategory): CSSProperties => ({
  display: 'inline-block',
  width: 10,
  height: 10,
  borderRadius: 5,
  background: COLOR[c].bg,
  marginRight: 8,
  verticalAlign: 'middle',
});

function GridRow({
  row,
  firstDate,
  off,
  height,
  laneH,
}: {
  row: PdfRow;
  firstDate: string;
  off: number[];
  height: number;
  laneH: number;
}) {
  const font = laneH >= 14 ? 10 : laneH >= 11 ? 9 : 7.5;
  return (
    <div style={{ position: 'relative', height, display: 'flex', borderTop: '1px solid #d4d4d8' }}>
      {row.dates.map((d, k) => {
        const weekly = off.includes((k + 6) % 7); // column 0 = Saturday = JS weekday 6
        const num = Number(d.slice(8, 10));
        return (
          <div
            key={d}
            style={{
              flex: 1,
              borderLeft: k ? '1px solid #e4e4e7' : undefined,
              background: weekly ? '#ececee' : '#ffffff',
              padding: '2px 4px',
              color: '#18181b',
              fontSize: 11,
            }}
          >
            {num === 1 || d === firstDate ? `${num} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : num}
          </div>
        );
      })}
      {row.bars.map((b) => {
        const c = COLOR[b.item.category];
        return (
          <div
            key={b.item.id}
            style={{
              position: 'absolute',
              left: `calc(${(b.startCol * 100) / 7}% + 2px)`,
              width: `calc(${((b.endCol - b.startCol + 1) * 100) / 7}% - 4px)`,
              top: 18 + b.lane * (laneH + 2),
              height: laneH,
              lineHeight: `${laneH}px`,
              fontSize: font,
              fontWeight: 600,
              padding: '0 4px',
              boxSizing: 'border-box',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              background: c.bg,
              color: c.fg,
              border: b.item.expected ? '1px dashed #ffffffcc' : undefined,
              borderRadius: `${b.continuesLeft ? 0 : 3}px ${b.continuesRight ? 0 : 3}px ${b.continuesRight ? 0 : 3}px ${b.continuesLeft ? 0 : 3}px`,
            }}
          >
            {b.item.text}
          </div>
        );
      })}
    </div>
  );
}

function TableRow({ r }: { r: PdfTableRow }) {
  return (
    <div
      className="pdf-avoid"
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        gap: 12,
        padding: '7px 8px',
        borderBottom: '1px solid #e4e4e7',
        fontSize: 14,
        alignItems: 'start',
      }}
    >
      <div style={{ fontWeight: 600 }}>{r.who}</div>
      <div>
        <span style={dot(r.category)} />
        {r.type}
        {r.note && <div style={{ fontSize: 11, color: GREY, marginLeft: 18 }}>{r.note}</div>}
      </div>
      <div>{r.off}</div>
      <div>{r.back}</div>
    </div>
  );
}

export function PrintLayout({ r }: { r: HolidayReport }) {
  const m = buildPdfModel(r);
  const TITLE_H = 40;
  const HEAD_H = 20;
  const LEGEND_H = 44;
  const rowH = Math.floor((PAGE_H - 8 - TITLE_H - HEAD_H - LEGEND_H - 6) / m.rows.length);
  const maxLanes = Math.max(1, ...m.rows.map((x) => x.lanes));
  const laneH = Math.max(9, Math.min(16, Math.floor((rowH - 22) / maxLanes) - 2));
  const swatch: CSSProperties = {
    display: 'inline-block',
    width: 22,
    height: 10,
    marginRight: 6,
    verticalAlign: 'middle',
  };
  return (
    <div>
      {/* Page 1: the calendar */}
      <div className="pdf-avoid" style={{ height: PAGE_H - 8, overflow: 'hidden' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, height: TITLE_H }}>{m.title}</h1>
        <div style={{ border: '1px solid #d4d4d8', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              height: HEAD_H,
              background: '#f4f4f5',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {DAYS.map((d, k) => (
              <div
                key={d}
                style={{
                  flex: 1,
                  padding: '3px 4px',
                  borderLeft: k ? '1px solid #e4e4e7' : undefined,
                }}
              >
                {d}
              </div>
            ))}
          </div>
          {m.rows.map((row) => (
            <GridRow
              key={row.dates[0]}
              row={row}
              firstDate={m.rows[0]!.dates[0]!}
              off={m.weeklyOffDays}
              height={rowH}
              laneH={laneH}
            />
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 18px',
            marginTop: 10,
            fontSize: 12,
            alignItems: 'center',
          }}
        >
          {m.types.map((c) => (
            <span key={c}>
              <span style={{ ...swatch, borderRadius: 3, background: COLOR[c].bg }} />
              {COLOR[c].label}
            </span>
          ))}
          <span>
            <span style={{ ...swatch, background: '#ececee', border: '1px solid #d4d4d8' }} />
            Weekly holiday ({m.weeklyOff})
          </span>
        </div>
      </div>

      {/* Page 2+: every holiday / break once */}
      <div style={{ marginTop: 18 }}>
        <div
          className="pdf-avoid"
          data-keep-next="1"
          style={{
            display: 'grid',
            gridTemplateColumns: COLS,
            gap: 12,
            padding: '6px 8px',
            background: '#f4f4f5',
            borderBottom: '1px solid #d4d4d8',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <div>Who</div>
          <div>Type</div>
          <div>Off</div>
          <div>Back to class</div>
        </div>
        {m.table.length === 0 ? (
          <div className="pdf-avoid" style={{ padding: '8px', fontSize: 14, color: GREY }}>
            No holidays or breaks.
          </div>
        ) : (
          m.table.map((row) => <TableRow key={row.key} r={row} />)
        )}
      </div>
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
