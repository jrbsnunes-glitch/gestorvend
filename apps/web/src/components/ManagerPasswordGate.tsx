import { useEffect, useRef, useState } from 'react';
import { setManagerPasswordPrompt, type ManagerPasswordRequest } from '../lib/api';
import { PermissionPasswordModal } from './PermissionPasswordModal';

type PendingPrompt = {
  request: ManagerPasswordRequest;
  resolve: (password: string | null) => void;
};

/**
 * Ponte única entre a API e o modal de senha do gerente. Toda chamada recusada
 * por falta de autorização (perfil Caixa em ação bloqueada na matriz de menus,
 * desconto, cancelamento etc.) abre este modal em primeiro plano e é reenviada
 * com a senha digitada. Prompts simultâneos entram em fila — um modal por vez.
 */
export function ManagerPasswordGate() {
  const current = useRef<PendingPrompt | null>(null);
  const queue = useRef<PendingPrompt[]>([]);
  const [, forceRender] = useState(0);

  useEffect(() => {
    setManagerPasswordPrompt(
      (request) =>
        new Promise<string | null>((resolve) => {
          const item: PendingPrompt = { request, resolve };
          if (current.current) {
            queue.current.push(item);
            return;
          }
          current.current = item;
          forceRender((n) => n + 1);
        }),
    );
    return () => {
      setManagerPasswordPrompt(null);
      const pending = [current.current, ...queue.current].filter(Boolean) as PendingPrompt[];
      current.current = null;
      queue.current = [];
      for (const p of pending) p.resolve(null);
    };
  }, []);

  function settle(password: string | null): void {
    const pending = current.current;
    current.current = queue.current.shift() ?? null;
    forceRender((n) => n + 1);
    pending?.resolve(password);
  }

  const pending = current.current;
  if (!pending) return null;

  return (
    <PermissionPasswordModal
      open
      title="Autorização do gerente"
      description={pending.request.message}
      confirmLabel="Autorizar e continuar"
      error={pending.request.retryError}
      onConfirm={(password) => settle(password.trim() ? password : null)}
      onClose={() => settle(null)}
    />
  );
}
