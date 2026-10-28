import { isGestorVendDesktop } from './desktop-bridge';

function isEditableField(
  el: EventTarget | null,
): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

function blurIfDetached(): void {
  const ae = document.activeElement;
  if (!(ae instanceof HTMLElement) || ae.isConnected) return;
  try {
    ae.blur();
  } catch {
    /* ignore */
  }
}

/**
 * Depois de um modal de pesquisa o Chromium no Electron pode deixar o foco
 * num nó já desmontado. Só tira esse foco zumbi — não chama win/webContents.focus(),
 * senão o teclado vai para a barra de menu e o próximo campo “acende” sem digitação.
 */
export function restoreDesktopKeyboard(): void {
  if (typeof document === 'undefined' || !isGestorVendDesktop()) return;
  blurIfDetached();
  const ae = document.activeElement;
  if (
    !(ae instanceof HTMLElement) ||
    !ae.isConnected ||
    ae === document.documentElement
  ) {
    if (!document.body.hasAttribute('tabindex')) {
      document.body.setAttribute('tabindex', '-1');
    }
    document.body.focus({ preventScroll: true });
  }
}

function neutralizeSearchInput(el: HTMLInputElement): void {
  if (el.type !== 'search') return;
  const hadFocus = document.activeElement === el;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  el.type = 'text';
  el.setAttribute('inputmode', 'search');
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('spellcheck', 'false');
  if (hadFocus) {
    el.focus({ preventScroll: true });
    try {
      if (start != null && end != null) el.setSelectionRange(start, end);
    } catch {
      /* ignore */
    }
  }
}

function neutralizeSearchTree(root: ParentNode): void {
  if (root instanceof HTMLInputElement) neutralizeSearchInput(root);
  root.querySelectorAll?.('input[type="search"]').forEach((node) => {
    if (node instanceof HTMLInputElement) neutralizeSearchInput(node);
  });
}

/**
 * Electron/Windows: o teclado some após a 1ª pesquisa porque o foco fica
 * num input desmontado ou na barra Alt. Recoloca no campo clicado e limpa zumbis.
 */
export function installDesktopInputUnlock(): void {
  if (typeof document === 'undefined' || !isGestorVendDesktop()) return;

  document.documentElement.classList.add('gv-desktop');
  document.body.setAttribute('tabindex', '-1');
  neutralizeSearchTree(document);

  document.addEventListener(
    'pointerdown',
    (e) => {
      blurIfDetached();
      const field = e.target instanceof HTMLElement ? e.target.closest('input, textarea, select') : null;
      if (!isEditableField(field) || field.disabled) return;
      if (field instanceof HTMLInputElement && field.readOnly) return;
      if (document.activeElement !== field) {
        field.focus({ preventScroll: true });
      }
    },
    true,
  );

  document.addEventListener(
    'focusin',
    () => {
      blurIfDetached();
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
      }
      blurIfDetached();
    },
    true,
  );

  const observer = new MutationObserver((mutations) => {
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && !ae.isConnected) restoreDesktopKeyboard();
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement || node instanceof DocumentFragment) {
          neutralizeSearchTree(node);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
