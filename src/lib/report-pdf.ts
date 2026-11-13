import type { jsPDF } from 'jspdf';
import { MONTHS_SHORT } from '@/core/calendar/months';
import type { HolidayReport, ReportCategory } from '@/core/report/build';
import { buildPdfModel } from '@/core/report/pdf-model';

const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatReportDate(iso: string): string {
  const clean = iso.slice(0, 10);
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const wd = WD_FULL[dateObj.getUTCDay()];
  const mon = MONTHS_FULL[m - 1];
  return `${wd}, ${d} ${mon} ${y}`;
}

export function formatReportDateShort(iso: string): string {
  const clean = iso.slice(0, 10);
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const mon = MONTHS_SHORT[m - 1];
  return `${d} ${mon} ${y}`;
}

export const formatDownloadDate = formatReportDate;
export const formatDownloadDateShort = formatReportDateShort;

// The report PDF, drawn directly with jsPDF text (A4 portrait). No screenshot of the page: it
// does not depend on html2canvas / foreignObject, so it cannot come out blank in the browser.
// jsPDF's built-in fonts only cover Latin, so a line with other characters (e.g. a Bengali
// holiday title) is drawn with the browser's own text rendering on a small canvas and placed
// as an image; every other line is real, selectable PDF text.

const PAGE_W = 210;
const PAGE_H = 297;
const ML = 12; // left/right margin, mm
const MT = 14;
const BOTTOM = PAGE_H - 16; // content stops here; "Page X of Y" sits below
const CONTENT_W = PAGE_W - 2 * ML;
const PT = 0.3528; // mm per point
const LINE = 1.35; // line height, times font size
const PX_MM = 12; // canvas pixels per mm for the image fallback (~300 dpi)

// Dot colours: same as the app (holiday, suspension, unofficial) and the Status page (breaks).
const DOT: Record<ReportCategory, string> = {
  HOLIDAY: '#dc2626',
  MID_BREAK: '#f97316',
  SEMESTER_BREAK: '#e11d48',
  SUSPENDED_WEEK: '#64748b',
  UNOFFICIAL_BREAK: '#d4d4d8',
};
const PHASE_DOT: Record<string, string> = {
  CLASS: '#10b981',
  MID_BREAK: '#f97316',
  VIVA: '#a855f7',
  EXAM: '#3b82f6',
  SEMESTER_BREAK: '#e11d48',
};
const GREY = '#52525b';

interface Style {
  size: number; // pt
  bold?: boolean;
  color?: string;
}

/** Characters jsPDF's standard fonts can draw (WinAnsi: Latin-1 plus common punctuation). */
export const isLatin = (s: string) => /^[ -~ -ÿ–—‘’“”•…]*$/.test(s);

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

class Writer {
  y = MT;
  private ctx: CanvasRenderingContext2D | null | undefined;

  constructor(readonly pdf: jsPDF) {}

  private canvasFont(st: Style) {
    return `${st.bold ? 700 : 400} ${st.size * PT * PX_MM}px system-ui, "Noto Sans Bengali", "Nirmala UI", sans-serif`;
  }
  private canvas() {
    if (this.ctx === undefined) this.ctx = document.createElement('canvas').getContext('2d');
    return this.ctx;
  }

  lineH(st: Style) {
    return st.size * PT * LINE;
  }

  /** Wraps `text` to `width` mm. */
  wrap(text: string, st: Style, width: number): string[] {
    if (isLatin(text)) {
      this.pdf.setFont('helvetica', st.bold ? 'bold' : 'normal');
      this.pdf.setFontSize(st.size);
      return this.pdf.splitTextToSize(text, width) as string[];
    }
    const ctx = this.canvas();
    if (!ctx) return [text];
    ctx.font = this.canvasFont(st);
    const lines: string[] = [];
    let cur = '';
    for (const word of text.split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(next).width / PX_MM > width) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    lines.push(cur);
    return lines;
  }

  /** Height of a wrapped paragraph. */
  height(lines: string[], st: Style) {
    return lines.length * this.lineH(st);
  }

  /** Starts a new page if `h` mm do not fit below the cursor. */
  ensure(h: number) {
    if (this.y + h > BOTTOM) {
      this.pdf.addPage();
      this.y = MT;
    }
  }

  /** Draws already-wrapped lines with their top at `top`. */
  draw(lines: string[], x: number, top: number, st: Style) {
    const lh = this.lineH(st);
    const [r, g, b] = rgb(st.color ?? '#18181b');
    lines.forEach((line, i) => {
      const y = top + i * lh;
      if (isLatin(line)) {
        this.pdf.setFont('helvetica', st.bold ? 'bold' : 'normal');
        this.pdf.setFontSize(st.size);
        this.pdf.setTextColor(r, g, b);
        this.pdf.text(line, x, y + lh * 0.75);
        return;
      }
      const ctx = this.canvas();
      if (!ctx) return;
      ctx.font = this.canvasFont(st);
      const w = Math.ceil(ctx.measureText(line).width) + 4;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = Math.ceil(lh * PX_MM);
      const g2 = c.getContext('2d')!;
      g2.font = this.canvasFont(st);
      g2.fillStyle = st.color ?? '#18181b';
      g2.textBaseline = 'alphabetic';
      g2.fillText(line, 0, lh * 0.75 * PX_MM);
      this.pdf.addImage(c.toDataURL('image/png'), 'PNG', x, y, w / PX_MM, lh);
    });
  }

  dot(category: ReportCategory, x: number, top: number, st: Style) {
    const [r, g, b] = rgb(DOT[category]);
    this.pdf.setFillColor(r, g, b);
    this.pdf.circle(x + 1.3, top + this.lineH(st) * 0.55, 1.15, 'F');
  }
}

/** Draws the whole report into `pdf` (pure layout: also used by the tests). */
export function drawReport(pdf: jsPDF, report: HolidayReport) {
  const m = buildPdfModel(report);
  const w = new Writer(pdf);

  const TITLE: Style = { size: 17, bold: true };
  const SECTION_HEAD: Style = { size: 11.5, bold: true, color: '#18181b' };
  const SUM: Style = { size: 9 };
  const SUM_LABEL: Style = { size: 9, bold: true };
  const SUB: Style = { size: 8.5, color: GREY };
  const NOTE: Style = { size: 8.5, color: GREY };

  // Title
  const title = w.wrap(m.title, TITLE, CONTENT_W);
  w.ensure(w.height(title, TITLE));
  w.draw(title, ML, w.y, TITLE);
  w.y += w.height(title, TITLE) + 1.5;

  const dateToShow = m.reportDate ?? m.downloadedAt;
  if (dateToShow) {
    const repText = `Report date: ${formatReportDate(dateToShow)}`;
    const repLines = w.wrap(repText, SUB, CONTENT_W);
    w.ensure(w.height(repLines, SUB));
    w.draw(repLines, ML, w.y, SUB);
    w.y += w.height(repLines, SUB) + 2.5;
  } else {
    w.y += 1;
  }

  // Department status summary (e.g. 31 Class · 1 Mid-term break · 2 Board Viva · 11 Final · 13 Semester break)
  if (m.statusSummary && m.statusSummary.length > 0) {
    const items = m.statusSummary;
    const boxH = 8.5;
    w.ensure(boxH + 3);
    const boxY = w.y;

    // Subtle container card
    pdf.setFillColor(250, 250, 250);
    pdf.setDrawColor(228, 228, 231);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(ML, boxY, CONTENT_W, boxH, 1.5, 1.5, 'FD');

    const colW = CONTENT_W / items.length;
    items.forEach((it, i) => {
      const colLeft = ML + i * colW;

      // Divider between columns
      if (i > 0) {
        pdf.setDrawColor(228, 228, 231);
        pdf.setLineWidth(0.25);
        pdf.line(colLeft, boxY + 1.5, colLeft, boxY + boxH - 1.5);
      }

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      const countStr = `${it.count} `;
      const countW = pdf.getTextWidth(countStr);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      const labelW = pdf.getTextWidth(it.label);

      const totalW = 3.5 + countW + labelW;
      const startX = colLeft + (colW - totalW) / 2;
      const textY = boxY + boxH / 2 + 1.1;

      // Color dot
      const [r, g, b] = rgb(PHASE_DOT[it.key] ?? '#71717a');
      pdf.setFillColor(r, g, b);
      pdf.circle(startX + 1.1, boxY + boxH / 2, 1.1, 'F');

      // Bold count
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(24, 24, 27);
      pdf.text(countStr, startX + 3.4, textY);

      // Label
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.setTextColor(63, 63, 70);
      pdf.text(it.label, startX + 3.4 + countW, textY);
    });

    w.y += boxH + 3.5;
  }

  // Summary: who is off, per week and type (in a structured table format)
  const sumTitle = w.wrap('Monthly Summary · At a Glance', SECTION_HEAD, CONTENT_W);
  w.ensure(w.height(sumTitle, SECTION_HEAD) + 16);
  w.y += 2;
  w.draw(sumTitle, ML, w.y, SECTION_HEAD);
  w.y += w.height(sumTitle, SECTION_HEAD) + 2;

  const C1_W = 28;
  const C2_W = 34;
  const C3_W = 76;
  const C4_W = 24;
  const C5_W = CONTENT_W - C1_W - C2_W - C3_W - C4_W; // 24mm
  const X0 = ML;
  const X1 = ML + C1_W;
  const X2 = X1 + C2_W;
  const X3 = X2 + C3_W;
  const X4 = X3 + C4_W;
  const X5 = X4 + C5_W;

  const TH_STYLE: Style = { size: 8.5, bold: true, color: '#3f3f46' };
  const TH_H = 6.2;
  const WEEK_ROW_H = 6.2;
  const WEEK_ROW_TITLE_STYLE: Style = { size: 8.5, bold: true, color: '#0f172a' };
  const DATE_STYLE: Style = { size: 8.5, color: '#27272a' };

  const drawTableHeader = (topY: number) => {
    pdf.setFillColor(244, 244, 245);
    pdf.rect(X0, topY, CONTENT_W, TH_H, 'F');

    pdf.setDrawColor(212, 212, 216);
    pdf.setLineWidth(0.3);
    pdf.rect(X0, topY, CONTENT_W, TH_H);

    pdf.setDrawColor(228, 228, 231);
    pdf.setLineWidth(0.2);
    pdf.line(X1, topY + 1, X1, topY + TH_H - 1);
    pdf.line(X2, topY + 1, X2, topY + TH_H - 1);
    pdf.line(X3, topY + 1, X3, topY + TH_H - 1);
    pdf.line(X4, topY + 1, X4, topY + TH_H - 1);

    const textY = topY + 1.3;
    w.draw(['Date'], X0 + 2.5, textY, TH_STYLE);
    w.draw(['Event Type'], X1 + 2.5, textY, TH_STYLE);
    w.draw(['Batches & Departments'], X2 + 2.5, textY, TH_STYLE);
    w.draw(['Student Count'], X3 + 2, textY, TH_STYLE);
    w.draw(['Bro count'], X4 + 2, textY, TH_STYLE);
  };

  drawTableHeader(w.y);
  w.y += TH_H;

  m.summary.forEach((week) => {
    const partsInfo = week.parts.map((p) => {
      const dateLines = w.wrap(p.date, DATE_STYLE, C1_W - 5);
      const labelLines = w.wrap(p.label, SUM_LABEL, C2_W - 5);
      const whoLines = w.wrap(p.who, SUM, C3_W - 5);
      const countLines =
        p.boysCount > 0
          ? [
              {
                text: p.boysCount.toLocaleString(),
                style: { size: 8.5, bold: true, color: '#18181b' },
              },
            ]
          : [{ text: '—', style: { size: 8.5, color: '#a1a1aa' } }];
      const brothersLines =
        p.brothersCount > 0
          ? [
              {
                text: p.brothersCount.toLocaleString(),
                style: { size: 8.5, bold: true, color: '#18181b' },
              },
            ]
          : [{ text: '—', style: { size: 8.5, color: '#a1a1aa' } }];
      const countH = countLines.reduce((acc, l) => acc + w.lineH(l.style), 0);
      const brothersH = brothersLines.reduce((acc, l) => acc + w.lineH(l.style), 0);
      const textH = Math.max(
        w.height(dateLines, DATE_STYLE),
        w.height(labelLines, SUM_LABEL),
        w.height(whoLines, SUM),
        countH,
        brothersH,
      );
      const rowH = Math.max(textH + 2.6, 5.8);
      return { p, dateLines, labelLines, whoLines, countLines, brothersLines, rowH };
    });

    const partsH =
      partsInfo.length > 0 ? partsInfo.reduce((acc, it) => acc + it.rowH, 0) : 6.0;
    const weekTotalH = WEEK_ROW_H + partsH;

    if (w.y + weekTotalH > BOTTOM) {
      w.pdf.addPage();
      w.y = MT;
      drawTableHeader(w.y);
      w.y += TH_H;
    }

    // Week header row
    const weekTop = w.y;
    pdf.setFillColor(241, 245, 249);
    pdf.rect(X0, weekTop, CONTENT_W, WEEK_ROW_H, 'F');

    w.draw([week.week], X0 + 2.5, weekTop + 1.3, WEEK_ROW_TITLE_STYLE);

    const totalStr = `Total students: ${week.totalBoysCount.toLocaleString()}  ·  Total brothers: ${week.totalBrothersCount.toLocaleString()}`;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(51, 65, 85);
    pdf.text(totalStr, X5 - 3, weekTop + 4.2, { align: 'right' });

    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.25);
    pdf.line(X0, weekTop, X5, weekTop);
    pdf.line(X0, weekTop, X0, weekTop + WEEK_ROW_H);
    pdf.line(X5, weekTop, X5, weekTop + WEEK_ROW_H);
    pdf.line(X0, weekTop + WEEK_ROW_H, X5, weekTop + WEEK_ROW_H);

    w.y += WEEK_ROW_H;

    if (partsInfo.length === 0) {
      const emptyH = 6.0;
      const emptyTop = w.y;
      w.draw(['No scheduled holidays or breaks'], X0 + 2.5, emptyTop + 1.4, {
        size: 8.5,
        color: GREY,
      });

      pdf.setDrawColor(212, 212, 216);
      pdf.setLineWidth(0.25);
      pdf.line(X0, emptyTop, X0, emptyTop + emptyH);
      pdf.line(X5, emptyTop, X5, emptyTop + emptyH);
      pdf.line(X0, emptyTop + emptyH, X5, emptyTop + emptyH);

      w.y += emptyH;
      return;
    }

    let curY = w.y;
    partsInfo.forEach((part, pIdx) => {
      if (pIdx > 0) {
        pdf.setDrawColor(228, 228, 231);
        pdf.setLineWidth(0.2);
        pdf.line(X0, curY, X5, curY);
      }
      w.draw(part.dateLines, X0 + 2.5, curY + 1.2, DATE_STYLE);
      w.draw(part.labelLines, X1 + 2.5, curY + 1.2, SUM_LABEL);
      w.draw(part.whoLines, X2 + 2.5, curY + 1.2, SUM);

      let countY = curY + 1.2;
      part.countLines.forEach((cl) => {
        w.draw([cl.text], X3 + 2, countY, cl.style);
        countY += w.lineH(cl.style);
      });

      let brothersY = curY + 1.2;
      part.brothersLines.forEach((bl) => {
        w.draw([bl.text], X4 + 2, brothersY, bl.style);
        brothersY += w.lineH(bl.style);
      });

      pdf.setDrawColor(228, 228, 231);
      pdf.setLineWidth(0.2);
      pdf.line(X1, curY, X1, curY + part.rowH);
      pdf.line(X2, curY, X2, curY + part.rowH);
      pdf.line(X3, curY, X3, curY + part.rowH);
      pdf.line(X4, curY, X4, curY + part.rowH);

      pdf.setDrawColor(212, 212, 216);
      pdf.setLineWidth(0.25);
      pdf.line(X0, curY, X0, curY + part.rowH);
      pdf.line(X5, curY, X5, curY + part.rowH);

      curY += part.rowH;
    });

    pdf.setDrawColor(212, 212, 216);
    pdf.setLineWidth(0.25);
    pdf.line(X0, curY, X5, curY);

    w.y = curY;
  });

  w.y += 1.8;
  const approxNote = w.wrap(
    '* Note: Student counts are approximate and exclude estimated female students.',
    { size: 7.5, color: '#71717a' },
    CONTENT_W,
  );
  w.draw(approxNote, ML, w.y, { size: 7.5, color: '#71717a' });
  w.y += w.height(approxNote, { size: 7.5 }) + 3;

  // Footer notes (kept together)
  const notes = [
    ...(m.noStatus.length
      ? [`Series with no status are not included: ${m.noStatus.join(', ')}.`]
      : []),
    'Dates marked “expected” depend on moon sighting.',
  ].flatMap((n) => w.wrap(n, NOTE, CONTENT_W));
  w.ensure(w.height(notes, NOTE) + 6);
  w.y += 6;
  w.draw(notes, ML, w.y, NOTE);

  // "Page X of Y" and Report Date
  const n = pdf.getNumberOfPages();
  const dateShort = (m.reportDate ?? m.downloadedAt)
    ? formatReportDateShort(m.reportDate ?? m.downloadedAt!)
    : '';
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(110, 110, 110);
    const footerText = dateShort
      ? `Report date: ${dateShort}   ·   Page ${i} of ${n}`
      : `Page ${i} of ${n}`;
    pdf.text(footerText, PAGE_W / 2, PAGE_H - 7, { align: 'center' });
  }
}

/** Builds the PDF and downloads it. The library loads on click. */
export async function downloadReportPdf(report: HolidayReport, fileName: string) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  drawReport(pdf, report);
  pdf.save(fileName);
}
