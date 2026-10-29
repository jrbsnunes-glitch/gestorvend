import type { BrowserWindow, WebContents, WebContentsPrintOptions } from 'electron';
import {
  bgraToEscPosRaster,
  darkPixelRatio,
  fitBgraToEscPosWidth,
  resolveBitmapSize,
  trimBgra,
} from './escpos-raster';
import { buildEscPosText, EXTRACT_RECEIPT_TICKET_JS, type ReceiptTicket } from './escpos-text';
import { sendRawToWindowsPrinter } from './windows-raw-print';

export type ThermalPrintPageSize = '80mm' | 'A4';

/**
 * Janela ~largura da bobina @ 96dpi.
 * A formatação visual fica no CSS do web (`sale-receipt-print.css`);
 * aqui só removemos chrome, anulamos @page A4, embutimos a logo e aplicamos a escala.
 */
export const THERMAL_WINDOW_WIDTH_PX = 302;

/** Electron `pageSize` usa mícrons (1 mm = 1000). */
const THERMAL_WIDTH_MICRONS = 80_000;
const THERMAL_MIN_HEIGHT_MICRONS = 80_000;
const THERMAL_MAX_HEIGHT_MICRONS = 2_000_000;
const THERMAL_FALLBACK_HEIGHT_MICRONS = 200_000;
const THERMAL_PAD_MICRONS = 12_000;

/** 1 CSS px @ 96 dpi = 25 400 / 96 mícrons. */
export function cssPxToMicrons(px: number): number {
  if (!Number.isFinite(px) || px <= 0) return 0;
  return Math.round((px * 25_400) / 96);
}

export function thermalPageSizeMicrons(contentHeightPx?: number): { width: number; height: number } {
  const measured = cssPxToMicrons(contentHeightPx ?? 0);
  const height =
    measured > 0
      ? Math.min(
          Math.max(measured + THERMAL_PAD_MICRONS, THERMAL_MIN_HEIGHT_MICRONS),
          THERMAL_MAX_HEIGHT_MICRONS,
        )
      : THERMAL_FALLBACK_HEIGHT_MICRONS;
  return { width: THERMAL_WIDTH_MICRONS, height };
}

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
        @page { size: 80mm auto !important; margin: 1.5mm !important; }
        html.gv-sale-receipt-print, html {
          margin: 0 !important;
          padding: 0 !important;
          width: 80mm !important;
          max-width: 80mm !important;
          height: auto !important;
          min-height: 0 !important;
          background: #fff !important;
          overflow: visible !important;
          font-size: 16px !important;
        }
        body.gv-sale-receipt-print, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 80mm !important;
          max-width: 80mm !important;
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
          width: 80mm !important;
          max-width: 80mm !important;
          background: #fff !important;
        }
        /*
         * Largura física da bobina, encostada à esquerda. Sem isso o cupom
         * fica centrado num canvas largo (janela do PDV) e o spooler captura
         * só a margem cinza — a térmica só empurra um pedaço de papel.
         */
        .sale-receipt-doc, article.sale-receipt-doc {
          width: 80mm !important;
          max-width: 80mm !important;
          margin: 0 !important;
          padding: 1mm 0.6mm 3mm !important;
          box-sizing: border-box !important;
          box-shadow: none !important;
          height: auto !important;
          min-height: 0 !important;
        }
        .sale-receipt-logo {
          display: block !important;
          margin-left: auto !important;
          margin-right: auto !important;
          max-width: 64mm !important;
          max-height: 30mm !important;
          object-fit: contain !important;
          object-position: center !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .sale-receipt-doc--nfce .sale-receipt-logo {
          max-width: 42mm !important;
          max-height: 14mm !important;
          margin-bottom: 0.08rem !important;
        }
        .sale-receipt-doc--nfce {
          font-size: 11px !important;
          line-height: 1.15 !important;
          padding: 1mm 0.6mm 2mm !important;
        }
        .sale-receipt-doc--nfce .nfce-qr,
        .sale-receipt-doc--nfce .sale-receipt-nfce-qr img {
          width: 24mm !important;
          height: 24mm !important;
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
} {
  const printOpts: WebContentsPrintOptions & {
    deviceName?: string;
    scaleFactor?: number;
  } = {
    silent: true,
    printBackground: true,
    margins: { marginType: 'none' },
    scaleFactor: 100,
  };

  if (opts.pageSize === 'A4') {
    printOpts.pageSize = 'A4';
  } else {
    // Sem pageSize numérico o Chromium manda A4; a térmica só avança a bobina.
    printOpts.pageSize = thermalPageSizeMicrons(opts.contentHeightPx);
  }

  if (opts.deviceName?.trim()) {
    printOpts.deviceName = opts.deviceName.trim();
  }

  return printOpts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type ReceiptCaptureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  clipped: boolean;
};

export async function measureSaleReceiptRect(wc: WebContents): Promise<ReceiptCaptureRect | null> {
  const box = (await wc.executeJavaScript(`
    (() => {
      const a = document.querySelector('article.sale-receipt-doc');
      if (!a) return null;
      try { a.scrollIntoView({ block: 'start', inline: 'nearest' }); } catch (_) {}
      const r = a.getBoundingClientRect();
      const ready =
        a.getAttribute('data-receipt-ready') === '1' || Boolean(a.querySelector('.sale-receipt-title'));
      if (!ready) return null;
      return {
        x: Math.max(0, Math.floor(r.left)),
        y: Math.max(0, Math.floor(r.top)),
        width: Math.max(1, Math.ceil(r.width)),
        height: Math.max(1, Math.ceil(r.height)),
        clipped: r.bottom > window.innerHeight + 8,
      };
    })()
  `)) as ReceiptCaptureRect | null;
  if (!box || box.width < 40 || box.height < 40) return null;
  return box;
}

async function printReceiptTextEscPos(wc: WebContents, device: string): Promise<boolean> {
  const ticket = (await wc.executeJavaScript(EXTRACT_RECEIPT_TICKET_JS).catch(() => null)) as
    | ReceiptTicket
    | null;
  if (!ticket?.title?.trim() && !ticket?.items?.length && !ticket?.totals?.length) {
    return false;
  }
  const payload = buildEscPosText(ticket);
  console.log(`[thermal-escpos-text] bytes=${payload.length} printer=${device} title=${ticket.title}`);
  await sendRawToWindowsPrinter(device, payload);
  return true;
}

async function sendCapturedImageEscPos(
  wc: WebContents,
  device: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<void> {
  let lastRatio = 0;
  let chosen: { width: number; height: number; bgra: Buffer } | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shot = await wc.capturePage(rect);
    if (shot.isEmpty()) {
      await sleep(160);
      continue;
    }
    const dip = shot.getSize();
    const raw = shot.toBitmap();
    const actual = resolveBitmapSize(raw, dip.width, dip.height);
    lastRatio = darkPixelRatio(raw, actual.width, actual.height);
    if (lastRatio >= 0.004) {
      const trimmed = trimBgra(raw, actual.width, actual.height);
      chosen = fitBgraToEscPosWidth(trimmed.bgra, trimmed.width, trimmed.height);
      break;
    }
    await sleep(160);
  }

  if (!chosen) {
    throw new Error(
      `Cupom capturado em branco (${(lastRatio * 100).toFixed(2)}% de tinta). Atualize o servidor e tente de novo.`,
    );
  }

  const payload = bgraToEscPosRaster(chosen.bgra, chosen.width, chosen.height);
  console.log(
    `[thermal-escpos] ${chosen.width}x${chosen.height} dots dark=${(lastRatio * 100).toFixed(2)}% bytes=${payload.length} printer=${device}`,
  );
  await sendRawToWindowsPrinter(device, payload);
}

/** Fotografa o article do preview (o que o operador vê) e manda para a térmica. */
async function printReceiptPreviewEscPos(wc: WebContents, device: string): Promise<void> {
  const rect = await measureSaleReceiptRect(wc);
  if (!rect) throw new Error('VISIBLE_RECEIPT_UNAVAILABLE');
  await sendCapturedImageEscPos(wc, device, rect);
}

/** Imprime o cupom que já está na tela (2ª via / botão Imprimir). */
export async function printVisibleReceiptEscPos(wc: WebContents, deviceName: string): Promise<void> {
  const device = deviceName.trim();
  if (!device) throw new Error('Defina a impressora do PDV em Configurações → Impressão.');
  try {
    await printReceiptPreviewEscPos(wc, device);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== 'VISIBLE_RECEIPT_UNAVAILABLE' && !/branco/i.test(msg)) throw err;
    if (await printReceiptTextEscPos(wc, device)) return;
    throw err;
  }
}

/**
 * Fotografa o cupom já preparado numa janela de impressão e manda ESC/POS RAW.
 */
export async function printPreparedReceiptEscPos(
  win: BrowserWindow,
  deviceName: string,
  contentHeightPx: number,
): Promise<void> {
  const device = deviceName.trim();
  if (!device) throw new Error('Defina a impressora do PDV em Configurações → Impressão.');

  const wc = win.webContents;
  const height = Math.max(200, Math.min(Math.round(contentHeightPx) + 48, 9000));
  try {
    win.setContentSize(THERMAL_WINDOW_WIDTH_PX + 24, height);
  } catch {
    /* janela principal pode recusar o resize — captura com recorte */
  }
  if (!win.isVisible()) {
    try {
      win.setOpacity(0);
    } catch {
      /* ignore */
    }
    win.showInactive();
  }
  try {
    await wc.executeJavaScript('document.body && document.body.offsetHeight');
  } catch {
    /* ignore */
  }
  await sleep(180);
  try {
    await printReceiptPreviewEscPos(wc, device);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== 'VISIBLE_RECEIPT_UNAVAILABLE' && !/branco/i.test(msg)) throw err;
    if (await printReceiptTextEscPos(wc, device)) return;
    throw err;
  }
}
