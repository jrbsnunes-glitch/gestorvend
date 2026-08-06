import type { WebContents, WebContentsPrintOptions } from 'electron';

export type ThermalPrintPageSize = '80mm' | 'A4';

/**
 * Janela ~largura da bobina @ 96dpi. Não usar layout “A4 com fontes gigantes”
 * nem caixinha 72mm com pageSize em microns (os dois extremos falharam no Windows).
 *
 * Estratégia: preencher 100% da página que o driver da térmica expõe (já é a
 * bobina) + tipografia de comprovante de mercado (~11–13 pt).
 */
export const THERMAL_WINDOW_WIDTH_PX = 302;

/**
 * Prepara o DOM do cupom: remove chrome, largura total, fontes de mercado.
 * @param receiptScale zoom tipográfico (1 = padrão mercado).
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
      const doc = document.querySelector('article.sale-receipt-doc');
      if (doc) {
        document.body.replaceChildren(doc);
      }
      const css = document.createElement('style');
      css.textContent = \`
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
        .sale-receipt-doc, article.sale-receipt-doc {
          width: 100% !important;
          max-width: none !important;
          margin: 0 !important;
          padding: 6px 8px 10px !important;
          box-sizing: border-box !important;
          box-shadow: none !important;
          height: auto !important;
          min-height: 0 !important;
          font-family: "Courier New", Courier, monospace !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          line-height: 1.32 !important;
          color: #000 !important;
          zoom: \${scale} !important;
        }
        .sale-receipt-title { font-size: 15px !important; font-weight: 800 !important; }
        .sale-receipt-sub,
        .sale-receipt-legal { font-size: 11px !important; font-weight: 600 !important; }
        .sale-receipt-meta,
        .sale-receipt-section-title,
        .sale-receipt-items,
        .sale-receipt-totals,
        .sale-receipt-payments,
        .sale-receipt-foot { font-size: 12px !important; font-weight: 700 !important; }
        .sale-receipt-item-sku,
        .sale-receipt-fiscal-note,
        .sale-receipt-foot-muted { font-size: 10px !important; font-weight: 600 !important; }
        .sale-receipt-totals-row.is-total { font-size: 15px !important; font-weight: 800 !important; }
        .sale-receipt-banner { font-size: 12px !important; }
        .sale-receipt-logo { max-width: 55% !important; max-height: 48px !important; }
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

export function buildThermalPrintOptions(opts: {
  deviceName?: string;
  pageSize?: ThermalPrintPageSize;
  contentHeightPx?: number;
}): WebContentsPrintOptions & {
  deviceName?: string;
  scaleFactor?: number;
  dpi?: { horizontal: number; vertical: number };
} {
  // Sem pageSize custom em microns e sem preferCSSPageSize 80mm:
  // no Windows isso faz o spooler encolher o cupom (letras minúsculas).
  // A página padrão da impressora térmica já é a bobina.
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
