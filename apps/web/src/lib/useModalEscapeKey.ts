import { useEffect } from 'react';

/** Pilha de modais abertos — ESC fecha só o mais recente (útil com modais aninhados). */
const modalCloseStack: Array<() => void> = [];

/**
 * Fecha o modal ao pressionar ESC. Só o modal no topo da pilha responde.
 */
export function useModalEscapeKey(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    modalCloseStack.push(onClose);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const top = modalCloseStack[modalCloseStack.length - 1];
      if (top !== onClose) return;
      e.preventDefault();
      top();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      const idx = modalCloseStack.lastIndexOf(onClose);
      if (idx >= 0) modalCloseStack.splice(idx, 1);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, enabled]);
}
