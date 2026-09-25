import type { ReactNode } from 'react';
import { FormModalBackdrop } from './FormModalBackdrop';

export type FormCadastroModalSize = 'md' | 'lg' | 'xl';

export type FormCadastroModalProps = {
  onClose: () => void;
  title: ReactNode;
  /** Texto introdutório abaixo do título */
  hint?: ReactNode;
  /** Alertas, abas, etc. — fica no cabeçalho fixo */
  headerExtra?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
  size?: FormCadastroModalSize;
  backdropClassName?: string;
  modalClassName?: string;
  dialogLabel?: string;
};

/**
 * Shell padrão de cadastro: cabe na viewport, scroll interno, ações fixas.
 * Use em novos formulários modais (ver regra form-cadastro-modal.mdc).
 */
export function FormCadastroModal({
  onClose,
  title,
  hint,
  headerExtra,
  children,
  footer,
  wide = true,
  size = 'lg',
  backdropClassName,
  modalClassName,
  dialogLabel,
}: FormCadastroModalProps) {
  const sizeClass =
    size === 'md' ? 'form-cadastro-modal--md' : size === 'xl' ? 'form-cadastro-modal--xl' : '';

  return (
    <FormModalBackdrop
      className={['modal-backdrop--cadastro', wide ? 'modal-backdrop--wide' : '', backdropClassName]
        .filter(Boolean)
        .join(' ')}
      onClose={onClose}
    >
      <div
        className={[
          'modal',
          'form-cadastro-modal',
          wide ? 'modal--wide' : '',
          sizeClass,
          modalClassName,
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-label={dialogLabel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="form-cadastro-modal__head">
          <h2>{title}</h2>
          {hint ? <div className="form-cadastro-modal__hint">{hint}</div> : null}
          {headerExtra}
        </div>
        <div className="form-cadastro-modal__body">{children}</div>
        <div className="modal-actions">{footer}</div>
      </div>
    </FormModalBackdrop>
  );
}

/** Classes para cadastros legados que ainda não usam FormCadastroModal. */
export function formCadastroModalShellClass(opts?: {
  wide?: boolean;
  size?: FormCadastroModalSize;
  extra?: string;
}): string {
  const wide = opts?.wide !== false;
  const size = opts?.size ?? 'lg';
  const sizeClass =
    size === 'md' ? 'form-cadastro-modal--md' : size === 'xl' ? 'form-cadastro-modal--xl' : '';
  return ['modal', 'form-cadastro-modal', wide ? 'modal--wide' : '', sizeClass, opts?.extra]
    .filter(Boolean)
    .join(' ');
}

export const FORM_CADASTRO_BACKDROP_CLASS = 'modal-backdrop--cadastro';
