import type { WebContents, WebContentsPrintOptions } from 'electron';

export type ThermalPrintPageSize = '80mm' | 'A4';

/** 80 mm @ 96 dpi ≈ 302 px — evita layout “desktop” que o spooler encolhe. */
export const THERMAL_WINDOW_WIDTH_PX = 302;

/**
 * Prepara o DOM do cupom para impressão térmica: remove chrome, colapsa altura
 * e deixa só o artigo do recibo (sem 100vh).
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
          width: 76mm !important;
          max-width: 76mm !important;
          margin: 0 auto !important;
          box-shadow: none !important;
          height: auto !important;
          min-height: 0 !important;
        }
      \`;
      document.head.appendChild(css);
      return true;
    })()
  `);

  await new Promise((r) => setTimeout(r, 100));

  const scrollH = Number(
    await wc.executeJavaScript(
      `Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1)`,
    ),
  );
  return Number.isFinite(scrollH) ? scrollH : 400;
}

/** px → microns (96 dpi). */
export function pxToMicrons(px: number): number {
  return Math.ceil((px * 25.4) / 96 * 1000);
}

export function buildThermalPrintOptions(opts: {
  deviceName?: string;
  pageSize?: ThermalPrintPageSize;
  contentHeightPx?: number;
}): WebContentsPrintOptions & { deviceName?: string; scaleFactor?: number } {
  const pageSize = opts.pageSize ?? '80mm';
  const printOpts: WebContentsPrintOptions & { deviceName?: string; scaleFactor?: number } = {
    silent: true,
    printBackground: true,
    margins: { marginType: 'none' },
    // Evita “ajustar à página” que miniaturiza o cupom na bobina.
    scaleFactor: 100,
  };

  if (pageSize === '80mm') {
    const contentMicrons = opts.contentHeightPx
      ? pxToMicrons(opts.contentHeightPx) + 12_000
      : 120_000;
    printOpts.pageSize = {
      width: 80_000,
      // Altura próxima do conteúdo — altura fixa enorme faz o fit-to-page encolher.
      height: Math.max(60_000, Math.min(contentMicrons, 400_000)),
    };
  } else {
    printOpts.pageSize = 'A4';
  }

  if (opts.deviceName?.trim()) {
    printOpts.deviceName = opts.deviceName.trim();
  }

  return printOpts;
}
