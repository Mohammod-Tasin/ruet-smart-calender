const SLACK = 16; // px
const PAGE = { w: 277, h: 186 }; // mm of printable area on A4 landscape with the margins below

/**
 * html2pdf's own page-break logic splits rows, so we pre-paginate: any `.pdf-avoid` block that
 * would cross a page boundary is pushed to the next page. A block marked `data-keep-next` (a
 * week heading) moves together with the block after it. Returns a function that undoes it.
 */
function paginate(el: HTMLElement) {
  const pageH = (el.offsetWidth * PAGE.h) / PAGE.w;
  const touched: HTMLElement[] = [];
  for (const row of el.querySelectorAll<HTMLElement>('.pdf-avoid')) {
    const base = el.getBoundingClientRect().top;
    const top = row.getBoundingClientRect().top - base;
    let height = row.offsetHeight;
    if (row.dataset.keepNext && row.nextElementSibling instanceof HTMLElement)
      height += row.nextElementSibling.offsetHeight;
    const page = Math.floor(top / pageH);
    // SLACK: html2canvas lays text out a few px taller than we measure here.
    if (height + SLACK < pageH && Math.floor((top + height + SLACK) / pageH) !== page) {
      row.style.marginTop = `${(page + 1) * pageH - top}px`;
      touched.push(row);
    }
  }
  return () => touched.forEach((r) => (r.style.marginTop = ''));
}

/** Renders the hidden print layout to an A4 PDF and downloads it. The library loads on click. */
export async function downloadReportPdf(el: HTMLElement, fileName: string) {
  await document.fonts.ready;
  const undo = paginate(el);
  try {
    await render(el, fileName);
  } finally {
    undo();
  }
}

async function render(el: HTMLElement, fileName: string) {
  const { default: html2pdf } = await import('html2pdf.js');
  const worker = html2pdf()
    .set({
      margin: [10, 10, 14, 10], // mm: top, left, bottom, right
      filename: fileName,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        foreignObjectRendering: true,
        // The print layout is fully inline-styled. Dropping the page CSS keeps html2canvas away
        // from Tailwind's lab()/oklch() colours, which it cannot parse.
        onclone: (doc: Document) =>
          doc.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => n.remove()),
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
    })
    .from(el)
    .toPdf();
  const pdf = await worker.get('pdf');
  const n = pdf.internal.getNumberOfPages();
  pdf.setFontSize(8);
  pdf.setTextColor(110);
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    pdf.text(`Page ${i} of ${n}`, 148.5, 204, { align: 'center' });
  }
  await worker.save();
}
