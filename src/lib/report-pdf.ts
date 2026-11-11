import type { jsPDF } from 'jspdf';
import type { HolidayReport, ReportCategory } from '@/core/report/build';
import { buildPdfModel } from '@/core/report/pdf-model';

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
const GREY = '#52525b';
const GREEN = '#166534';

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
  const SUM_HEAD: Style = { size: 11.5, bold: true };
  const SUM: Style = { size: 9.5 };
  const WEEK: Style = { size: 14, bold: true };
  const ENTRY: Style = { size: 11, bold: true };
  const SUB: Style = { size: 9, color: GREY };
  const BACK: Style = { size: 9, color: GREEN };
  const NOTE: Style = { size: 8.5, color: GREY };

  // Title
  const title = w.wrap(m.title, TITLE, CONTENT_W);
  w.ensure(w.height(title, TITLE));
  w.draw(title, ML, w.y, TITLE);
  w.y += w.height(title, TITLE) + 2;

  // Summary: who is off, per week and type
  const LABEL_W = 36;
  const whoX = ML + 5 + LABEL_W + 2;
  for (const week of m.summary) {
    const head = w.wrap(week.week, SUM_HEAD, CONTENT_W);
    const rows = week.parts.map((p) => {
      const label = w.wrap(p.label, SUM, LABEL_W);
      const who = w.wrap(p.who, SUM, PAGE_W - ML - whoX);
      return { p, label, who, h: Math.max(w.height(label, SUM), w.height(who, SUM)) + 1.4 };
    });
    const none = w.wrap('No breaks', SUM, CONTENT_W);
    // The heading stays with its first line.
    w.ensure(w.height(head, SUM_HEAD) + (rows[0]?.h ?? w.height(none, SUM) + 1.4));
    w.y += 2.5;
    w.draw(head, ML, w.y, SUM_HEAD);
    w.y += w.height(head, SUM_HEAD) + 0.8;
    if (rows.length === 0) {
      w.draw(none, ML, w.y, { ...SUM, color: GREY });
      w.y += w.height(none, SUM) + 1.4;
    }
    for (const r of rows) {
      w.ensure(r.h);
      w.dot(r.p.category, ML, w.y, SUM);
      w.draw(r.label, ML + 5, w.y, SUM);
      w.draw(r.who, whoX, w.y, SUM);
      w.y += r.h;
    }
  }

  // Details: one section per week
  const EX = ML + 6; // text x next to the dot
  for (const week of m.weeks) {
    const head = w.wrap(week.heading, WEEK, CONTENT_W);
    const items = week.entries.map((e) => {
      const text = w.wrap(e.text, ENTRY, PAGE_W - ML - EX);
      const sub = e.sub ? w.wrap(e.sub, SUB, PAGE_W - ML - EX) : [];
      const back = e.resume ? w.wrap(e.resume, BACK, PAGE_W - ML - EX) : [];
      return {
        e,
        text,
        sub,
        back,
        h: w.height(text, ENTRY) + w.height(sub, SUB) + w.height(back, BACK) + 2.4,
      };
    });
    const empty = w.wrap('No holidays or breaks.', { size: 10.5 }, CONTENT_W);
    w.ensure(w.height(head, WEEK) + 2 + (items[0]?.h ?? w.height(empty, { size: 10.5 })));
    w.y += 6;
    w.draw(head, ML, w.y, WEEK);
    w.y += w.height(head, WEEK) + 0.6;
    pdf.setDrawColor(212, 212, 216);
    pdf.setLineWidth(0.25);
    pdf.line(ML, w.y, PAGE_W - ML, w.y);
    w.y += 1.6;
    if (items.length === 0) {
      w.draw(empty, ML, w.y, { size: 10.5, color: GREY });
      w.y += w.height(empty, { size: 10.5 }) + 2;
    }
    for (const it of items) {
      w.ensure(it.h);
      const top = w.y + 1.2;
      w.dot(it.e.category, ML, top, ENTRY);
      w.draw(it.text, EX, top, ENTRY);
      let y = top + w.height(it.text, ENTRY);
      w.draw(it.sub, EX, y, SUB);
      y += w.height(it.sub, SUB);
      w.draw(it.back, EX, y, BACK);
      w.y += it.h;
    }
  }

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

  // "Page X of Y"
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(110, 110, 110);
    pdf.text(`Page ${i} of ${n}`, PAGE_W / 2, PAGE_H - 7, { align: 'center' });
  }
}

/** Builds the PDF and downloads it. The library loads on click. */
export async function downloadReportPdf(report: HolidayReport, fileName: string) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  drawReport(pdf, report);
  pdf.save(fileName);
}
