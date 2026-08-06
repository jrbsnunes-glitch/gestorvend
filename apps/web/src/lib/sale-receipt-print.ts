/**
 * Impressão de cupom não fiscal no PDV.
 *
 * No **GestorVend Desktop**, com impressora configurada em Configurações → Impressão,
 * o cupom sai em silêncio na térmica 80 mm (`printSilent` + deviceName).
 * No navegador puro, usa o diálogo Imprimir do sistema.
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
 * Carrega o cupom numa janela dedicada e dispara a impressão.
 * Evita iframe 0×0 (vários navegadores/spoolers geram página em branco).
 */
export function queueSaleReceiptAutoPrint(saleId: string): void {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const url = `/vendas/impressao?id=${encodeURIComponent(saleId)}&autoprint=1&_np=${encodeURIComponent(nonce)}&close=1`;
  const w = window.open(url, 'gv_sale_receipt', 'noopener,noreferrer,width=420,height=720');
  if (w) return;

  // Fallback se pop-up bloqueado: iframe com tamanho real (fora da tela).
  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:80mm;height:120mm;border:0;opacity:0.01;z-index:-1;';
  iframe.src = url;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'Cupom de venda');
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
