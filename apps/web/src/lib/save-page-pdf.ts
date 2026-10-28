/**
 * Gera um PDF da tela de relatório no próprio aparelho.
 * Serve para o PWA (atalho da tela inicial), onde window.print() não abre.
 */

function pickPdfSource(): HTMLElement {
  return (
    (document.querySelector('.print-page') as HTMLElement | null) ||
    (document.querySelector('.print-doc') as HTMLElement | null) ||
    (document.querySelector('.print-area') as HTMLElement | null) ||
    (document.querySelector('.main-content') as HTMLElement | null) ||
    document.body
  );
}

function pdfFileName(): string {
  const heading =
    document.querySelector('.print-doc h1, .gv-report-doc-head h1, .print-page h1, h1')?.textContent ||
    document.title ||
    'relatorio';
  const slug = heading
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .toLowerCase();
  const day = new Date().toISOString().slice(0, 10);
  return `${slug || 'relatorio'}-${day}.pdf`;
}

function prepareClone(doc: Document): void {
  doc.documentElement.classList.add('gv-saving-pdf');
  doc.querySelectorAll('.no-print').forEach((el) => {
    (el as HTMLElement).style.setProperty('display', 'none', 'important');
  });
  doc.querySelectorAll('.gv-report-print-only, .print-only').forEach((el) => {
    (el as HTMLElement).style.setProperty('display', 'block', 'important');
  });
}

async function shareOrDownload(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'application/pdf' });
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  try {
    if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: filename });
      return;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function saveCurrentPagePdf(): Promise<void> {
  if (typeof window === 'undefined') return;
  const source = pickPdfSource();
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const maxEdge = 8192;
  const scale = Math.max(1, Math.min(2, maxEdge / Math.max(source.scrollHeight, 1)));

  const canvas = await html2canvas(source, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: Math.max(source.scrollWidth, source.clientWidth),
    windowHeight: Math.max(source.scrollHeight, source.clientHeight),
    onclone: (doc) => prepareClone(doc),
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / Math.max(canvas.width, 1);
  const img = canvas.toDataURL('image/jpeg', 0.86);

  let heightLeft = imgH;
  let y = 0;
  pdf.addImage(img, 'JPEG', 0, y, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 1) {
    y -= pageH;
    pdf.addPage();
    pdf.addImage(img, 'JPEG', 0, y, imgW, imgH);
    heightLeft -= pageH;
  }

  const filename = pdfFileName();
  await shareOrDownload(pdf.output('blob'), filename);
}
