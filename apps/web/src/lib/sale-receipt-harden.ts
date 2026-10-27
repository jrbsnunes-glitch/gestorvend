/**
 * Blindagem do layout do cupom não fiscal.
 *
 * O shell do Desktop injeta uma folha de estilo com `!important` antes de
 * imprimir. Na cascata do CSS, declaração `!important` **inline** vence
 * `!important` de folha de estilo — então aplicar as regras do cupom no
 * atributo `style` garante o layout da empresa em qualquer versão do Desktop
 * (inclusive Setups antigos, que achatavam a tipografia).
 *
 * Largura, `padding` e `zoom` ficam de fora: são o que o shell precisa ajustar
 * para a bobina e para a escala configurada no PDV.
 */

type Decls = Record<string, string>;

/** Sem serifa de x-alto: na térmica 1-bit o Courier some (traço fino vira cinza). */
const FONT_STACK = "Verdana, Tahoma, 'Segoe UI', Arial, sans-serif";

/**
 * Área imprimível de uma bobina de 80 mm (o mecanismo imprime ~72 mm).
 * Precisa ser largura física fixa: com `width: 100%` o documento assume a
 * largura da página que o driver expõe (muitas vezes A4) e tudo que é
 * alinhado à direita — valores, datas, e até o cabeçalho centralizado —
 * cai fora do papel e sai cortado.
 */
export const RECEIPT_PRINT_WIDTH_MM = 80;

const RULES: Array<{ selector: string; decls: Decls }> = [
  {
    selector: '.sale-receipt-doc',
    decls: {
      width: `${RECEIPT_PRINT_WIDTH_MM}mm`,
      'max-width': `${RECEIPT_PRINT_WIDTH_MM}mm`,
      'min-width': '0',
      'box-sizing': 'border-box',
      padding: '1mm 1.5mm 3mm',
      margin: '0',
      // A escala é tipográfica: `zoom`/`transform` alargariam a caixa e voltariam a cortar.
      zoom: '1',
      transform: 'none',
      'font-family': FONT_STACK,
      'font-size': '17px',
      'font-weight': '800',
      'line-height': '1.35',
      color: '#000',
      '-webkit-font-smoothing': 'antialiased',
      'font-smooth': 'always',
      'text-rendering': 'geometricPrecision',
      background: '#fff',
      'box-shadow': 'none',
      overflow: 'visible',
    },
  },
  { selector: '.sale-receipt-doc strong', decls: { 'font-weight': '800' } },
  { selector: '.sale-receipt-center', decls: { 'text-align': 'center' } },
  {
    selector: '.sale-receipt-logo',
    decls: {
      display: 'block',
      'margin-left': 'auto',
      'margin-right': 'auto',
      'margin-bottom': '0.4rem',
      'max-width': '64mm',
      'max-height': '30mm',
      width: 'auto',
      height: 'auto',
      'object-fit': 'contain',
      'object-position': 'center center',
    },
  },
  {
    selector: '.sale-receipt-title',
    decls: {
      'font-size': '20px',
      'font-weight': '800',
      'letter-spacing': '0',
      'text-transform': 'uppercase',
      'text-align': 'center',
      margin: '0.35rem 0 0.25rem',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-legal',
    decls: {
      'font-size': '14px',
      'font-weight': '800',
      'text-align': 'center',
      margin: '0',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-sub',
    decls: {
      'font-size': '14px',
      'font-weight': '800',
      margin: '0 0 0.2rem',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-line',
    decls: {
      border: 'none',
      'border-top': '1.5px dashed #000',
      margin: '0.45rem 0',
      opacity: '1',
    },
  },
  {
    selector: '.sale-receipt-fiscal-note',
    decls: {
      'font-size': '13px',
      'font-weight': '800',
      'text-align': 'center',
      margin: '0 0 0.35rem',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-banner',
    decls: {
      'text-align': 'center',
      'font-weight': '800',
      'font-size': '16px',
      'text-transform': 'uppercase',
      margin: '0.25rem 0 0.15rem',
      padding: '0.25rem',
      background: '#fecaca',
      color: '#450a0a',
      '-webkit-print-color-adjust': 'exact',
      'print-color-adjust': 'exact',
    },
  },
  {
    selector: '.sale-receipt-meta',
    decls: {
      display: 'flex',
      'justify-content': 'space-between',
      gap: '0.5rem',
      'flex-wrap': 'wrap',
      'font-size': '14px',
      'font-weight': '800',
      margin: '0.2rem 0',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-section-title',
    decls: {
      'font-size': '15px',
      'font-weight': '800',
      'text-transform': 'uppercase',
      'letter-spacing': '0',
      margin: '0.55rem 0 0.3rem',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-items',
    decls: {
      margin: '0',
      padding: '0',
      'list-style': 'none',
      'font-size': '15px',
      'font-weight': '800',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-items li',
    decls: {
      margin: '0.45rem 0',
      'padding-bottom': '0.35rem',
      'border-bottom': '1px dotted #000',
    },
  },
  { selector: '.sale-receipt-item-desc', decls: { display: 'block', 'word-break': 'break-word' } },
  {
    selector: '.sale-receipt-item-qty',
    decls: {
      display: 'flex',
      'justify-content': 'space-between',
      gap: '0.35rem',
      'flex-wrap': 'wrap',
      'font-weight': '800',
      'margin-top': '0.2rem',
    },
  },
  {
    selector: '.sale-receipt-item-sku',
    decls: { display: 'block', 'font-size': '13px', 'font-weight': '800', color: '#000' },
  },
  {
    selector: '.sale-receipt-totals',
    decls: { 'margin-top': '0.5rem', 'font-size': '15px', 'font-weight': '800', color: '#000' },
  },
  {
    selector: '.sale-receipt-totals-row',
    decls: { display: 'flex', 'justify-content': 'space-between', margin: '0.2rem 0' },
  },
  {
    selector: '.sale-receipt-totals-row.is-total',
    decls: {
      'font-size': '19px',
      'font-weight': '800',
      'margin-top': '0.4rem',
      'padding-top': '0.35rem',
      'border-top': '2px solid #000',
    },
  },
  {
    selector: '.sale-receipt-totals-row.is-sold',
    decls: {
      'font-size': '16px',
      'font-weight': '800',
      margin: '0.45rem 0',
      padding: '0.4rem 0.15rem',
      'border-top': '2px solid #000',
      'border-bottom': '2px solid #000',
    },
  },
  {
    selector: '.sale-receipt-totals-row.is-outflow',
    decls: {
      'font-size': '14px',
      'font-weight': '800',
      margin: '0.28rem 0',
      padding: '0.28rem 0.15rem',
      border: '2px solid #000',
    },
  },
  {
    selector: '.sale-receipt-payments',
    decls: {
      margin: '0.4rem 0 0',
      padding: '0',
      'list-style': 'none',
      'font-size': '15px',
      'font-weight': '800',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-payments li',
    decls: { display: 'flex', 'justify-content': 'space-between', margin: '0.2rem 0' },
  },
  {
    selector: '.sale-receipt-foot',
    decls: {
      'text-align': 'center',
      'font-size': '14px',
      'font-weight': '800',
      margin: '0.7rem 0 0.25rem',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-foot-muted',
    decls: {
      'text-align': 'center',
      'font-size': '12px',
      'font-weight': '800',
      'line-height': '1.35',
      margin: '0.4rem 0 0',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-nfce-key',
    decls: {
      'word-break': 'break-word',
      'text-align': 'center',
      'font-size': '11px',
      'font-weight': '800',
      margin: '0.35rem 0',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-nfce-qr',
    decls: {
      display: 'flex',
      'justify-content': 'center',
      margin: '0.45rem 0 0.2rem',
    },
  },
  {
    selector: '.nfce-qr',
    decls: {
      display: 'block',
      width: '32mm',
      height: '32mm',
    },
  },
  {
    selector: '.sale-receipt-doc--nfce .sale-receipt-logo',
    decls: {
      'max-width': '58mm',
      'max-height': '24mm',
      'margin-bottom': '0.2rem',
    },
  },
  {
    selector: '.sale-receipt-doc--nfce .sale-receipt-title',
    decls: {
      'font-size': '12px',
      margin: '0.1rem 0 0.06rem',
      'letter-spacing': '0',
    },
  },
  {
    selector: '.sale-receipt-doc--nfce .sale-receipt-sub, .sale-receipt-doc--nfce .sale-receipt-legal',
    decls: {
      'font-size': '10px',
      'line-height': '1.2',
      margin: '0 0 0.05rem',
    },
  },
  {
    selector: '.sale-receipt-doc--nfce .sale-receipt-fiscal-note',
    decls: {
      'font-size': '9px',
      'line-height': '1.2',
      margin: '0 0 0.08rem',
    },
  },
  {
    selector: '.sale-receipt-doc--nfce .sale-receipt-line',
    decls: { margin: '0.25rem 0' },
  },
  {
    selector: '.sale-receipt-doc--nfce .sale-receipt-nfce-key',
    decls: { 'font-size': '9px', margin: '0.15rem 0' },
  },
  {
    selector: '.sale-receipt-doc--nfce .nfce-qr',
    decls: { width: '28mm', height: '28mm' },
  },
  {
    selector: '.sale-receipt-doc--nfce .sale-receipt-foot',
    decls: { 'font-size': '10px', margin: '0.4rem 0 0.1rem' },
  },
  {
    selector: '.sale-receipt-doc--nfce .sale-receipt-foot-muted',
    decls: { 'font-size': '8px', margin: '0.15rem 0 0' },
  },
];

/** Aplica a escala do PDV só na tipografia (a caixa continua com a largura da bobina). */
function scaleValue(prop: string, value: string, scale: number): string {
  if (scale === 1) return value;
  if (prop !== 'font-size') return value;
  const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
  if (!px) return value;
  return `${Math.round(Number(px[1]) * scale * 100) / 100}px`;
}

/**
 * Grava as regras do cupom no atributo `style` com prioridade `important`.
 * @param scale multiplicador tipográfico configurado no PDV (1 = base).
 */
export function hardenSaleReceiptStyles(root: ParentNode, scale = 1): void {
  const factor = Number.isFinite(scale) ? Math.max(0.75, Math.min(2, scale)) : 1;
  for (const { selector, decls } of RULES) {
    const targets =
      root instanceof HTMLElement && root.matches(selector)
        ? [root, ...Array.from(root.querySelectorAll<HTMLElement>(selector))]
        : Array.from(root.querySelectorAll<HTMLElement>(selector));
    for (const el of targets) {
      for (const [prop, value] of Object.entries(decls)) {
        el.style.setProperty(prop, scaleValue(prop, value, factor), 'important');
      }
    }
  }
}

/**
 * Converte as imagens do cupom (logo da loja) em `data:` URL.
 * Assim a impressão não depende de rede/sessão no momento do spool.
 */
export async function inlineSaleReceiptImages(root: ParentNode): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) return;
      try {
        const res = await fetch(src, { credentials: 'same-origin' });
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        img.removeAttribute('srcset');
        img.src = dataUrl;
      } catch {
        /* mantém a URL original */
      }
    }),
  );
}

/** Espera as imagens decodificarem (evita cupom impresso sem a logo). */
export async function waitSaleReceiptImages(root: ParentNode): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          window.setTimeout(done, 2500);
        }),
    ),
  );
}
