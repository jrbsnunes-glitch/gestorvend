import type { WebContents, WebContentsPrintOptions } from 'electron';

export type ThermalPrintPageSize = '80mm' | 'A4';

/**
 * Largura útil ~72 mm @ 96 dpi. Com a impressora térmica como destino,
 * a “página” do spooler já é a bobina — tipografia de cupom de mercado
 * (não fontes gigantes pensadas para compensar shrink A4).
 */
export const THERMAL_WINDOW_WIDTH_PX = 280;

/**
 * Prepara o DOM do cupom: remove chrome e aplica tipografia de comprovante 80 mm.
 */
export async function prepareSaleReceiptForThermalPrint(wc: WebContents): Promise<number> {
  await wc.executeJavaScript(`
    (() => {
      document.querySelectorAll('.no-print, .sale-receipt-toolbar').forEach((el) => el.remove());
      const doc = document.querySelector('article.sale-receipt-doc');
      if (doc) {
        document.body.replaceChildren(doc);
      }
      const css = document.createElement('style');
      css.textContent = \`
        @page { size: 80mm auto; margin: 2mm; }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 80mm !important;
          max-width: 80mm !important;
          height: auto !important;
          min-height: 0 !important;
          background: #fff !important;
          overflow: visible !important;
        }
        .sale-receipt-doc, article.sale-receipt-doc {
          width: 72mm !important;
          max-width: 72mm !important;
          margin: 0 auto !important;
          padding: 1.5mm 1.5mm 3mm !important;
          box-sizing: border-box !important;
          box-shadow: none !important;
          height: auto !important;
          min-height: 0 !important;
          font-family: "Courier New", Courier, monospace !important;
          font-size: 11pt !important;
          font-weight: 700 !important;
          line-height: 1.3 !important;
          color: #000 !important;
        }
        .sale-receipt-title { font-size: 13pt !important; font-weight: 800 !important; }
        .sale-receipt-sub,
        .sale-receipt-legal { font-size: 9pt !important; font-weight: 600 !important; }
        .sale-receipt-meta,
        .sale-receipt-section-title,
        .sale-receipt-items,
        .sale-receipt-totals,
        .sale-receipt-payments,
        .sale-receipt-foot { font-size: 10pt !important; font-weight: 700 !important; }
        .sale-receipt-item-sku,
        .sale-receipt-fiscal-note,
        .sale-receipt-foot-muted { font-size: 8.5pt !important; font-weight: 600 !important; }
        .sale-receipt-totals-row.is-total { font-size: 13pt !important; font-weight: 800 !important; }
        .sale-receipt-banner { font-size: 11pt !important; }
        .sale-receipt-logo { max-width: 42mm !important; max-height: 14mm !important; }
      \`;
      document.head.appendChild(css);
      return true;
    })()
  `);

  await new Promise((r) => setTimeout(r, 120));

  const scrollH = Number(
    await wc.executeJavaScript(
      `Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1)`,
    ),
  );
  return Number.isFinite(scrollH) ? scrollH : 400;
}

/** px → microns (96 dpi). */
export function pxToMicrons(px: number): number {
  return Math.ceil(((px * 25.4) / 96) * 1000);
}

export function buildThermalPrintOptions(opts: {
  deviceName?: string;
  pageSize?: ThermalPrintPageSize;
  contentHeightPx?: number;
}): WebContentsPrintOptions & {
  deviceName?: string;
  scaleFactor?: number;
  dpi?: { horizontal: number; vertical: number };
  preferCSSPageSize?: boolean;
} {
  const pageSize = opts.pageSize ?? '80mm';
  const printOpts: WebContentsPrintOptions & {
    deviceName?: string;
    scaleFactor?: number;
    dpi?: { horizontal: number; vertical: number };
    preferCSSPageSize?: boolean;
  } = {
    silent: true,
    printBackground: true,
    margins: { marginType: 'none' },
    scaleFactor: 100,
    dpi: { horizontal: 203, vertical: 203 },
    preferCSSPageSize: true,
  };

  if (pageSize === '80mm') {
    const contentMicrons = opts.contentHeightPx
      ? pxToMicrons(opts.contentHeightPx) + 10_000
      : 100_000;
    printOpts.pageSize = {
      width: 80_000,
      height: Math.max(50_000, Math.min(contentMicrons, 350_000)),
    };
  }

  if (opts.deviceName?.trim()) {
    printOpts.deviceName = opts.deviceName.trim();
  }

  return printOpts;
}
