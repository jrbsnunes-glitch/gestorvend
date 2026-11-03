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

function editableFromEvent(e: Event): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  const t = e.target;
  const field = t instanceof HTMLElement ? t.closest('input, textarea, select') : null;
  if (!isEditableField(field) || field.disabled) return null;
  if (field instanceof HTMLInputElement && field.readOnly) return null;
  return field;
}

function focusField(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  if (!field.isConnected) return;
  try {
    field.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
}

let lastRefocusAt = 0;

/** Janela sem foco do SO: só o processo principal (blur+focus) devolve o teclado. */
function refocusWindowIfNeeded(field?: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null): void {
  if (document.hasFocus()) return;
  const api = getDesktopApi();
  if (!api?.refocusKeyboard) return;
  const now = Date.now();
  if (now - lastRefocusAt < 250) return;
  lastRefocusAt = now;
  api.refocusKeyboard();
  if (field) {
    window.setTimeout(() => focusField(field), 30);
    window.setTimeout(() => focusField(field), 160);
  }
}

/**
 * Substitui alert/confirm/prompt pelo diálogo do processo principal. O
 * MessageBox do Chromium no Windows deixa os campos sem teclado depois de
 * fechar; prompt() nem existe no Electron.
 */
function installDesktopDialogs(): void {
  const api = getDesktopApi();
  const dialogSync = api?.dialogSync;
  if (!dialogSync) return;
  const restoreAfter = () => {
    window.setTimeout(() => {
      blurIfDetached();
      const ae = document.activeElement;
      if (isEditableField(ae) && ae.isConnected) focusField(ae);
    }, 60);
  };
  window.alert = (message?: unknown) => {
    dialogSync('alert', message == null ? '' : String(message));
    restoreAfter();
  };
  window.confirm = (message?: string) => {
    const ok = dialogSync('confirm', message == null ? '' : String(message)) === true;
    restoreAfter();
    return ok;
  };
  window.prompt = (message?: string, defaultValue?: string) => {
    const r = dialogSync(
      'prompt',
      message == null ? '' : String(message),
      defaultValue == null ? '' : String(defaultValue),
    );
    restoreAfter();
    return typeof r === 'string' ? r : null;
  };
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
  installDesktopDialogs();

  document.addEventListener(
    'pointerdown',
    (e) => {
      blurIfDetached();
      const field = editableFromEvent(e);
      if (!field) {
        refocusWindowIfNeeded(null);
        return;
      }
      refocusWindowIfNeeded(field);
      if (document.activeElement !== field) focusField(field);
      requestAnimationFrame(() => {
        if (document.activeElement !== field) focusField(field);
      });
    },
    true,
  );

  document.addEventListener(
    'click',
    (e) => {
      const field = editableFromEvent(e);
      if (!field) return;
      if (document.activeElement !== field) focusField(field);
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

  window.addEventListener('focus', () => {
    restoreDesktopKeyboard();
  });

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
