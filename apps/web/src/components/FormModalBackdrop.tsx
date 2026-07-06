import type { CSSProperties, ReactNode } from 'react';
import { useModalEscapeKey } from '../lib/useModalEscapeKey';

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
    <div
      className={['modal-backdrop', className].filter(Boolean).join(' ')}
      role="presentation"
      style={style}
    >
      {children}
    </div>
  );
}
