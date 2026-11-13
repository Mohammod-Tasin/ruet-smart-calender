import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';
import { buildReport, type ReportInput, type ReportSeries } from '@/core/report/build';
import { drawReport, isLatin } from '@/lib/report-pdf';

const mk = (id: number, dept: number, code: string, year: number): ReportSeries => ({
  id,
  label: `${code}-${year % 100}`,
  departmentId: dept,
  intakeYear: year,
});
const series = [mk(1, 1, 'CSE', 23), mk(2, 2, 'EEE', 23), mk(4, 1, 'CSE', 24)].map((s) => ({
  ...s,
  intakeYear: 2000 + s.intakeYear,
}));

const input = (n: number): ReportInput => ({
  from: '2026-11-11',
  holidays: [
    {
      id: 1,
      title: 'Victory Day',
      category: 'HOLIDAY',
      classesOnly: false,
      startDate: '2026-12-01',
      endDate: '2026-12-01',
      label: 'ALL',
      tentative: false,
    },
  ],
  // n breaks: enough of them to run onto a second page
  // n breaks with different ranges (each becomes its own entry): enough to run onto a second page
  breaks: Array.from({ length: n }, (_, i) => ({
    category: i % 2 ? 'MID_BREAK' : 'SEMESTER_BREAK',
    startDate: `2026-11-${14 + (i % 7)}`,
    endDate: `2026-11-${20 + (Math.floor(i / 7) % 8)}`,
    seriesId: series[i % 3]!.id,
    semesterNo: (i % 8) + 1,
  })),
  series,
  noStatus: [2],
  weeklyOff: [4, 5],
});

const pdfOf = (n: number) => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  drawReport(pdf, buildReport(input(n)));
  return pdf;
};

describe('drawReport', () => {
  it('puts the title, summary, details and notes in the PDF as text', () => {
    const pdf = pdfOf(3);
    const raw = pdf.output();
    expect(raw).toContain('14 Nov');
    expect(raw).toContain('4 Dec 2026');
    expect(raw).toContain('Date');
    expect(raw).toContain('Event Type');
    expect(raw).toContain('Batches & Departments');
    expect(raw).toContain('Total students');
    expect(raw).toContain('Total brothers');
    expect(raw).toContain('Student Count');
    expect(raw).toContain('Bro count');
    expect(raw).toContain('approx');
    expect(raw).toContain('Mid-term break');
    expect(raw).toContain('Semester break');
    expect(raw).toContain('Victory Day');
    expect(raw).toContain('Series with no status are not included');
    expect(raw).toContain('Page 1 of 1');
  });

  it('draws the monthly title and downloaded date on the page', () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    drawReport(
      pdf,
      buildReport({
        ...input(3),
        month: '2026-11',
        downloadedAt: '2026-11-13',
        statusSummary: {
          CLASS: 31,
          MID_BREAK: 1,
          VIVA: 2,
          EXAM: 11,
          SEMESTER_BREAK: 13,
        },
      }),
    );
    const raw = pdf.output();
    expect(raw).toContain('November 2026');
    expect(raw).toContain('Report date: Friday, 13 November 2026');
    expect(raw).toContain('Report date: 13 Nov 2026');
    expect(raw).toContain('31');
    expect(raw).toContain('Class');
    expect(raw).toContain('Board Viva');
    expect(raw).toContain('11');
    expect(raw).toContain('Final');
    expect(raw).toContain('13');
  });

  it('flows onto more pages and numbers them', () => {
    const pdf = pdfOf(60);
    const pages = pdf.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    const raw = pdf.output();
    for (let i = 1; i <= pages; i++) expect(raw).toContain(`Page ${i} of ${pages}`);
  });
});

describe('isLatin', () => {
  it.each([
    ['Victory Day · Wed 16 Dec – everyone off', true],
    ['“expected”', true],
    ['জাতীয় বিপ্লব ও সংহতি দিবস · 7 Nov', false],
  ])('%s', (s, ok) => expect(isLatin(s)).toBe(ok));
});
