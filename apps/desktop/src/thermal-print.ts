import type { WebContents, WebContentsPrintOptions } from 'electron';

export type ThermalPrintPageSize = '80mm' | 'A4';

/**
 * Janela ~largura da bobina @ 96dpi.
 * A formatação visual fica no CSS do web (`sale-receipt-print.css`);
 * aqui só removemos chrome, anulamos @page A4, embutimos a logo e aplicamos a escala.
 */
export const THERMAL_WINDOW_WIDTH_PX = 302;

async function inlineReceiptImages(wc: WebContents): Promise<void> {
  // Timeout curto — não pode travar o job de impressão se a logo falhar.
  await Promise.race([
    wc.executeJavaScript(`
      (async () => {
        const imgs = Array.from(
          document.querySelectorAll('article.sale-receipt-doc img.sale-receipt-logo, article.sale-receipt-doc img'),
        );
        await Promise.all(
          imgs.map(async (img) => {
            try {
              const src = img.currentSrc || img.src;
              if (!src || src.startsWith('data:')) return;
              const ctrl = new AbortController();
              const timer = setTimeout(() => ctrl.abort(), 1200);
              const res = await fetch(src, {
                credentials: 'same-origin',
                cache: 'force-cache',
                signal: ctrl.signal,
              });
              clearTimeout(timer);
              if (!res.ok) return;
              const blob = await res.blob();
              const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              if (typeof dataUrl === 'string') {
                img.src = dataUrl;
                img.removeAttribute('srcset');
              }
            } catch {
              /* mantém src original */
            }
          }),
        );
        return true;
      })()
    `),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
}

/**
 * Prepara o DOM do cupom sem apagar a tipografia/layout do sistema.
 *
 * A escala e a largura da bobina são aplicadas pela própria página (ela lê
 * `pdv.receiptScale` pelo bridge). Aqui só removemos o chrome e ajustamos a
 * página para o spooler — mexer em width/zoom daqui cortava a coluna da direita.
 */
export async function prepareSaleReceiptForThermalPrint(wc: WebContents): Promise<number> {
  // Preferível ter cabeçalho; se não tiver, ainda imprime o article (não bloqueia a térmica).
  const hasArticle = await wc.executeJavaScript(
    `Boolean(document.querySelector('article.sale-receipt-doc'))`,
  );
  if (!hasArticle) {
    throw new Error('Cupom não encontrado na página.');
  }

  await inlineReceiptImages(wc);

  await wc.executeJavaScript(`
    (() => {
      document.documentElement.classList.add('gv-sale-receipt-print');
      document.body.classList.add('gv-sale-receipt-print');

      document.querySelectorAll('.no-print, .sale-receipt-toolbar').forEach((el) => el.remove());

      const page = document.querySelector('.sale-receipt-page');
      const doc = document.querySelector('article.sale-receipt-doc');
      if (page && doc) {
        page.replaceChildren(doc);
        document.body.replaceChildren(page);
      } else if (doc) {
        document.body.replaceChildren(doc);
      }

      let style = document.getElementById('gv-thermal-print-prep');
      if (!style) {
        style = document.createElement('style');
        style.id = 'gv-thermal-print-prep';
        document.head.appendChild(style);
      }
      style.textContent = \`
        @page { size: 80mm auto !important; margin: 0 !important; }
        html.gv-sale-receipt-print, html {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          max-width: none !important;
          height: auto !important;
          min-height: 0 !important;
          background: #fff !important;
          overflow: visible !important;
          font-size: 16px !important;
        }
        body.gv-sale-receipt-print, body {
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
        /*
         * Geometria e escala são responsabilidade da página (largura física da
         * bobina + escala tipográfica). Aqui não se mexe em width/zoom: com
         * width:100% o cupom assumia a largura da página do driver e a coluna
         * da direita (valores, data) saía cortada no papel.
         */
        .sale-receipt-doc, article.sale-receipt-doc {
          margin: 0 !important;
          box-shadow: none !important;
          height: auto !important;
          min-height: 0 !important;
        }
        .sale-receipt-logo {
          display: block !important;
          margin-left: auto !important;
          margin-right: auto !important;
          max-width: 52mm !important;
          max-height: 20mm !important;
          object-fit: contain !important;
          object-position: center !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .sale-receipt-company, .sale-receipt-title, .sale-receipt-sub, .sale-receipt-legal {
          text-align: center !important;
          color: #000 !important;
        }
        .sale-receipt-line {
          border: none !important;
          border-top: 1.5px dashed #000 !important;
        }
      \`;
      return true;
    })()
  `);

  await new Promise((r) => setTimeout(r, 80));

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
