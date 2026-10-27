import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalEscapeKey } from '../lib/useModalEscapeKey';

type PortalModalBackdropProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
};

/**
 * Backdrop no `document.body` para escapar o stacking do Electron
 * (sidebar z-40, chip do usuário z-30, PDV z-10). Sem o portal, campos
 * de pesquisa e digitação ficam visualmente ativos mas não recebem clique.
 */
export function PortalModalBackdrop({ children, className, style, onClick }: PortalModalBackdropProps) {
  const node = (
    <div
      className={['modal-backdrop', className].filter(Boolean).join(' ')}
      role="presentation"
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  );
  if (typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}

type FormModalBackdropProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClose: () => void;
};

/** Backdrop de formulário: não fecha ao clicar fora; ESC chama onClose. */
export function FormModalBackdrop({ children, className, style, onClose }: FormModalBackdropProps) {
  useModalEscapeKey(onClose);

  return (
    <PortalModalBackdrop className={className} style={style}>
      {children}
    </PortalModalBackdrop>
  );
}
