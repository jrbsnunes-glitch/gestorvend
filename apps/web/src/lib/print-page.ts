/**
 * Impressão da página atual.
 *
 * No celular (iOS em especial) `window.print()` só funciona no toque do usuário.
 * Auto-print via setTimeout é ignorado e, em PWA/standalone, o diálogo nem abre.
 */

export function isMobilePrintHost(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const ua = navigator.userAgent || '';
    const ios =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(ua);
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    return ios || android || (coarse && narrow);
  } catch {
    return false;
  }
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true;
  } catch {
    return false;
  }
}

/** Auto-print após carregar o relatório — só no desktop. */
export function shouldAutoPrint(): boolean {
  return !isMobilePrintHost() && !isStandaloneDisplay();
}

export function scheduleAutoPrint(delayMs = 400): void {
  if (typeof window === 'undefined' || !shouldAutoPrint()) return;
  window.setTimeout(() => printCurrentPage(), delayMs);
}

export function printCurrentPage(): void {
  if (typeof window === 'undefined') return;

  try {
    window.print();
  } catch {
    announcePrintUnavailable();
    return;
  }

  if (!isMobilePrintHost() && !isStandaloneDisplay()) return;

  let opened = false;
  const markOpened = () => {
    opened = true;
  };
  window.addEventListener('beforeprint', markOpened);
  window.addEventListener('afterprint', markOpened);
  window.setTimeout(() => {
    window.removeEventListener('beforeprint', markOpened);
    window.removeEventListener('afterprint', markOpened);
    if (!opened) announcePrintUnavailable();
  }, 900);
}

function announcePrintUnavailable(): void {
  try {
    window.dispatchEvent(
      new CustomEvent('gv-print-unavailable', {
        detail: { standalone: isStandaloneDisplay() },
      }),
    );
  } catch {
    window.alert(
      'Não foi possível abrir a impressão neste aparelho. Use o menu do navegador: Compartilhar → Imprimir, ou Salvar em PDF.',
    );
  }
}
