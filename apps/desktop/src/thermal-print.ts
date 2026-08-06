import type { WebContents, WebContentsPrintOptions } from 'electron';

export type ThermalPrintPageSize = '80mm' | 'A4';

/**
 * Janela ~largura da bobina @ 96dpi.
 * A formatação visual fica no CSS do web (`sale-receipt-print.css`);
 * aqui só removemos chrome e aplicamos a escala configurada.
 */
export const THERMAL_WINDOW_WIDTH_PX = 302;

/**
 * Prepara o DOM do cupom sem sobrescrever a tipografia/layout do sistema.
 * @param receiptScale zoom tipográfico (1 = base do CSS; padrão recomendado 1.2).
 */
export async function prepareSaleReceiptForThermalPrint(
  wc: WebContents,
  receiptScale = 1,
): Promise<number> {
  const scale = Math.max(0.75, Math.min(2, receiptScale || 1));
  await wc.executeJavaScript(`
    (() => {
      const scale = ${JSON.stringify(scale)};
      document.querySelectorAll('.no-print, .sale-receipt-toolbar').forEach((el) => el.remove());

      const page = document.querySelector('.sale-receipt-page');
      const doc = document.querySelector('article.sale-receipt-doc');
      if (page && doc) {
        // Mantém o article (classes/estrutura) e limpa o restante da página.
        page.replaceChildren(doc);
        document.body.replaceChildren(page);
      } else if (doc) {
        document.body.replaceChildren(doc);
      }

      // Só layout de impressão + escala — não redefine fontes/cores do cupom.
      let style = document.getElementById('gv-thermal-print-prep');
      if (!style) {
        style = document.createElement('style');
        style.id = 'gv-thermal-print-prep';
        document.head.appendChild(style);
      }
      style.textContent = \`
        @page { margin: 0; }
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
        .sale-receipt-page {
          margin: 0 !important;
          padding: 0 !important;
          min-height: 0 !important;
          height: auto !important;
          width: 100% !important;
          max-width: none !important;
          background: #fff !important;
        }
        .sale-receipt-doc, article.sale-receipt-doc {
          width: 100% !important;
          max-width: none !important;
          margin: 0 !important;
          box-shadow: none !important;
          height: auto !important;
          min-height: 0 !important;
          zoom: \${scale};
        }
      \`;
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

export function buildThermalPrintOptions(opts: {
  deviceName?: string;
  pageSize?: ThermalPrintPageSize;
  contentHeightPx?: number;
}): WebContentsPrintOptions & {
  deviceName?: string;
  scaleFactor?: number;
  dpi?: { horizontal: number; vertical: number };
} {
  const printOpts: WebContentsPrintOptions & {
    deviceName?: string;
    scaleFactor?: number;
    dpi?: { horizontal: number; vertical: number };
  } = {
    silent: true,
    printBackground: true,
    margins: { marginType: 'none' },
    scaleFactor: 100,
    dpi: { horizontal: 203, vertical: 203 },
  };

  if (opts.deviceName?.trim()) {
    printOpts.deviceName = opts.deviceName.trim();
  }

  return printOpts;
}
