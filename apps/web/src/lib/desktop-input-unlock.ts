import { getDesktopApi, isGestorVendDesktop } from './desktop-bridge';

function isEditableField(
  el: EventTarget | null,
): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

/**
 * Após fechar um modal de pesquisa o Electron/Windows deixa o foco num nó
 * desconectado ou no menu Alt — o campo “acende” mas a tecla some até F5.
 */
export function restoreDesktopKeyboard(): void {
  if (typeof document === 'undefined' || !isGestorVendDesktop()) return;
  const ae = document.activeElement;
  if (ae instanceof HTMLElement && !ae.isConnected) {
    try {
      ae.blur();
    } catch {
      /* ignore */
    }
  }
  const alive = document.activeElement;
  if (
    alive instanceof HTMLElement &&
    alive !== document.body &&
    alive !== document.documentElement &&
    !isEditableField(alive) &&
    !alive.isConnected
  ) {
    document.body.focus();
  }
  getDesktopApi()?.focusWindow?.();
}

/**
 * Electron/Windows: recoloca o teclado no campo clicado e recupera após modal.
 */
export function installDesktopInputUnlock(): void {
  if (typeof document === 'undefined' || !isGestorVendDesktop()) return;

  document.documentElement.classList.add('gv-desktop');

  let lastField: HTMLElement | null = null;

  const unlock = (target: EventTarget | null) => {
    const field = target instanceof HTMLElement ? target.closest('input, textarea, select') : null;
    if (!isEditableField(field) || field.disabled) return;
    if (field instanceof HTMLInputElement && field.readOnly) return;
    lastField = field;
    if (document.activeElement !== field) {
      field.focus({ preventScroll: true });
    }
  };

  document.addEventListener('pointerdown', (e) => unlock(e.target), true);

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && !ae.isConnected) {
        restoreDesktopKeyboard();
        if (lastField?.isConnected && isEditableField(lastField) && !lastField.disabled) {
          lastField.focus({ preventScroll: true });
        }
        return;
      }
      if (isEditableField(ae) && ae.isConnected) return;
      if (lastField?.isConnected && isEditableField(lastField) && !lastField.disabled) {
        if (e.key.length === 1 || e.key === 'Backspace') {
          lastField.focus({ preventScroll: true });
        }
      }
    },
    true,
  );

  let hadBackdrop = document.querySelector('.modal-backdrop') != null;
  const observer = new MutationObserver(() => {
    const has = document.querySelector('.modal-backdrop') != null;
    if (hadBackdrop && !has) {
      lastField = null;
      restoreDesktopKeyboard();
    }
    hadBackdrop = has;
  });
  observer.observe(document.body, { childList: true, subtree: false });
}
