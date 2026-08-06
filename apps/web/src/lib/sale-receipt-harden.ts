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

const FONT_STACK = "'Courier New', Courier, 'Liberation Mono', monospace";

const RULES: Array<{ selector: string; decls: Decls }> = [
  {
    selector: '.sale-receipt-doc',
    decls: {
      'font-family': FONT_STACK,
      'font-size': '13px',
      'font-weight': '700',
      'line-height': '1.35',
      color: '#000',
      background: '#fff',
      'box-shadow': 'none',
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
      'margin-bottom': '0.35rem',
      'max-width': '52mm',
      'max-height': '20mm',
      width: 'auto',
      height: 'auto',
      'object-fit': 'contain',
      'object-position': 'center center',
    },
  },
  {
    selector: '.sale-receipt-title',
    decls: {
      'font-size': '15px',
      'font-weight': '800',
      'letter-spacing': '0.02em',
      'text-transform': 'uppercase',
      'text-align': 'center',
      margin: '0.35rem 0 0.25rem',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-legal',
    decls: {
      'font-size': '12px',
      'font-weight': '700',
      'text-align': 'center',
      margin: '0',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-sub',
    decls: {
      'font-size': '12px',
      'font-weight': '700',
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
      'font-size': '11px',
      'font-weight': '700',
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
      'font-size': '13px',
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
      'font-size': '12px',
      'font-weight': '700',
      margin: '0.2rem 0',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-section-title',
    decls: {
      'font-size': '12px',
      'font-weight': '800',
      'text-transform': 'uppercase',
      'letter-spacing': '0.04em',
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
      'font-size': '12px',
      'font-weight': '700',
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
    decls: { display: 'block', 'font-size': '11px', 'font-weight': '700', color: '#000' },
  },
  {
    selector: '.sale-receipt-totals',
    decls: { 'margin-top': '0.5rem', 'font-size': '12px', 'font-weight': '700', color: '#000' },
  },
  {
    selector: '.sale-receipt-totals-row',
    decls: { display: 'flex', 'justify-content': 'space-between', margin: '0.2rem 0' },
  },
  {
    selector: '.sale-receipt-totals-row.is-total',
    decls: {
      'font-size': '15px',
      'font-weight': '800',
      'margin-top': '0.4rem',
      'padding-top': '0.35rem',
      'border-top': '2px solid #000',
    },
  },
  {
    selector: '.sale-receipt-payments',
    decls: {
      margin: '0.4rem 0 0',
      padding: '0',
      'list-style': 'none',
      'font-size': '12px',
      'font-weight': '700',
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
      'font-size': '12px',
      'font-weight': '700',
      margin: '0.7rem 0 0.25rem',
      color: '#000',
    },
  },
  {
    selector: '.sale-receipt-foot-muted',
    decls: {
      'text-align': 'center',
      'font-size': '10px',
      'font-weight': '700',
      'line-height': '1.35',
      margin: '0.4rem 0 0',
      color: '#000',
    },
  },
];

/** Grava as regras do cupom no atributo `style` com prioridade `important`. */
export function hardenSaleReceiptStyles(root: ParentNode): void {
  for (const { selector, decls } of RULES) {
    const targets =
      root instanceof HTMLElement && root.matches(selector)
        ? [root, ...Array.from(root.querySelectorAll<HTMLElement>(selector))]
        : Array.from(root.querySelectorAll<HTMLElement>(selector));
    for (const el of targets) {
      for (const [prop, value] of Object.entries(decls)) {
        el.style.setProperty(prop, value, 'important');
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
