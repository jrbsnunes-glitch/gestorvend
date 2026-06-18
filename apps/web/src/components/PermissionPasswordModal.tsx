import { useEffect, useRef } from 'react';

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (password: string) => void;
  onClose: () => void;
};

/** Modal para senha de autorização de permissões operacionais. */
export function PermissionPasswordModal({
  open,
  title,
  description,
  confirmLabel = 'Autorizar',
  busy = false,
  error = null,
  onConfirm,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop no-print" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perm-pwd-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
        <h2 id="perm-pwd-title">{title}</h2>
        <p style={{ marginTop: 0, color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
          {description}
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const pwd = inputRef.current?.value ?? '';
            onConfirm(pwd);
          }}
        >
          <div className="field">
            <label htmlFor="perm-pwd-input">Senha de autorização</label>
            <input
              ref={inputRef}
              id="perm-pwd-input"
              type="password"
              autoComplete="off"
              disabled={busy}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Verificando…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
