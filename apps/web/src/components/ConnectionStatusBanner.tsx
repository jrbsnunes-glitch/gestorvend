import { useConnectionStatus } from '../hooks/useConnectionStatus';

export function ConnectionStatusBanner() {
  const { status, checking, recheck } = useConnectionStatus();

  if (status === 'online') return null;

  const message =
    status === 'offline'
      ? 'Sem conexão com a internet. As alterações podem não ser salvas até a rede voltar.'
      : 'Não foi possível contatar o servidor. Verifique se a API está em execução ou aguarde alguns instantes.';

  return (
    <div
      className={`connection-banner connection-banner--${status}`}
      role="status"
      aria-live="polite"
    >
      <span className="connection-banner__text">{message}</span>
      <button
        type="button"
        className="btn btn-secondary btn-sm connection-banner__retry"
        disabled={checking}
        onClick={() => void recheck()}
      >
        {checking ? 'Verificando…' : 'Tentar novamente'}
      </button>
    </div>
  );
}
