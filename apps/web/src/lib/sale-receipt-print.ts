/**
 * Impressão de cupom não fiscal no PDV.
 *
 * **Nuvem × impressora local:** o GestorVend na nuvem não acessa USB/rede do PC do
 * cliente. Quem imprime é sempre o **navegador** na máquina do operador (diálogo
 * Imprimir → impressora definida no Windows/macOS). Não é possível, em HTML puro,
 * escolher programaticamente o nome da impressora nem imprimir em silêncio sem
 * permissões especiais (quiosque, extensão ou serviço local tipo “print bridge”).
 *
 * Este módulo:
 * - enfileira o cupom em um iframe invisível com `autoprint=1` (evita bloqueio de pop-up);
 * - `SaleReceiptPrintPage` chama `window.print()` ao carregar quando `autoprint=1`;
 * - permite **preferência na estação** (`localStorage`) além do padrão do cadastro Empresa.
 */

const POS_AUTO_PRINT_KEY = 'gv_pos_auto_print_receipt';

export type PosAutoPrintMode = 'inherit' | 'on' | 'off';

export function getPosAutoPrintMode(): PosAutoPrintMode {
  try {
    const v = localStorage.getItem(POS_AUTO_PRINT_KEY);
    if (v === 'on' || v === 'off' || v === 'inherit') return v;
  } catch {
    /* private mode etc. */
  }
  return 'inherit';
}

export function setPosAutoPrintMode(mode: PosAutoPrintMode): void {
  try {
    localStorage.setItem(POS_AUTO_PRINT_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Respeita cadastro da empresa quando mode === inherit. */
export function effectiveAutoPrintAfterSale(companyDefault: boolean): boolean {
  const mode = getPosAutoPrintMode();
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return companyDefault;
}

const autoprintNonceDone = new Set<string>();

/**
 * Evita chamada dupla de `print()` (ex.: React Strict Mode em desenvolvimento).
 */
export function consumeAutoPrintNonce(nonce: string | null, saleId: string): boolean {
  const key = nonce?.trim() ? `np:${nonce}` : `sid:${saleId}`;
  if (autoprintNonceDone.has(key)) return false;
  autoprintNonceDone.add(key);
  if (autoprintNonceDone.size > 80) {
    autoprintNonceDone.clear();
  }
  return true;
}

/**
 * Carrega o cupom em iframe oculto; a página dispara `window.print()` ao ficar pronta.
 */
export function queueSaleReceiptAutoPrint(saleId: string): void {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;inset:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  iframe.src = `/vendas/impressao?id=${encodeURIComponent(saleId)}&autoprint=1&_np=${encodeURIComponent(nonce)}`;
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);
  window.setTimeout(() => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  }, 120_000);
}

export function posAutoPrintModeLabel(mode: PosAutoPrintMode): string {
  if (mode === 'on') return 'Sempre imprimir após venda';
  if (mode === 'off') return 'Nunca imprimir automaticamente';
  return 'Seguir cadastro da empresa';
}
