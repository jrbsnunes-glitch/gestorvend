import type { WebContents, WebContentsPrintOptions } from 'electron';

export type ThermalPrintPageSize = '80mm' | 'A4';

/**
 * Largura ~A4 @ 96dpi. No Windows, drivers térmicos costumam ignorar pageSize
 * em microns e tratar o job como página A4 — se o cupom tiver só 80 mm de CSS,
 * ele vira uma faixinha e as letras saem minúsculas na bobina.
 * Preenchemos a “página” inteira com tipografia grande; ao mapear A4→80 mm
 * o texto continua legível.
 */
export const THERMAL_WINDOW_WIDTH_PX = 794;

/**
 * Prepara o DOM do cupom: remove chrome, largura total da página e fontes grandes.
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
        @page { size: auto; margin: 0; }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          max-width: none !important;
          height: auto !important;
          min-height: 0 !important;
          background: #fff !important;
          overflow: visible !important;
        }
        .sale-receipt-doc, article.sale-receipt-doc {
          width: 100% !important;
          max-width: none !important;
          margin: 0 !important;
          padding: 10px 14px 16px !important;
          box-sizing: border-box !important;
          box-shadow: none !important;
          height: auto !important;
          min-height: 0 !important;
          font-family: "Courier New", Courier, monospace !important;
          font-size: 34px !important;
          font-weight: 800 !important;
          line-height: 1.28 !important;
          color: #000 !important;
        }
        .sale-receipt-title { font-size: 44px !important; font-weight: 900 !important; }
        .sale-receipt-sub,
        .sale-receipt-legal,
        .sale-receipt-meta,
        .sale-receipt-section-title,
        .sale-receipt-items,
        .sale-receipt-totals,
        .sale-receipt-payments,
        .sale-receipt-foot { font-size: 32px !important; font-weight: 800 !important; }
        .sale-receipt-item-sku,
        .sale-receipt-fiscal-note,
        .sale-receipt-foot-muted { font-size: 28px !important; font-weight: 700 !important; }
        .sale-receipt-totals-row.is-total { font-size: 46px !important; font-weight: 900 !important; }
        .sale-receipt-banner { font-size: 34px !important; }
        .sale-receipt-logo { max-width: 70% !important; max-height: 90px !important; }
      \`;
      document.head.appendChild(css);
      return true;
    })()
  `);

  await new Promise((r) => setTimeout(r, 150));

  const scrollH = Number(
    await wc.executeJavaScript(
      `Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1)`,
    ),
  );
  return Number.isFinite(scrollH) ? scrollH : 600;
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
    // 203 DPI típico de térmica 80 mm
    dpi: { horizontal: 203, vertical: 203 },
    // Não forçar pageSize em microns: no Windows isso costuma ser ignorado e o
    // driver imprime como A4, miniaturizando o layout de 80 mm.
    preferCSSPageSize: false,
  };

  if (opts.deviceName?.trim()) {
    printOpts.deviceName = opts.deviceName.trim();
  }

  return printOpts;
}
