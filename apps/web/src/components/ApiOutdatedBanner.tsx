import { useEffect, useState } from 'react';
import { GV_API_OUTDATED_EVENT } from '../lib/api';
import { APP_VERSION } from '../version';

const DISMISS_KEY = 'gv_api_outdated_dismiss';

/**
 * Aviso quando alguma rota chamada pelo front não existe na API em execução.
 * Acontece quando o servidor publica o build novo do web mas não reinicia a API:
 * as telas novas ficam vazias sem explicação (ex.: gráfico do Início zerado).
 */
export function ApiOutdatedBanner() {
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === APP_VERSION) return;
    } catch {
      /* ignore */
    }
    function onOutdated(event: Event) {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      setPath(detail?.path ?? '');
    }
    window.addEventListener(GV_API_OUTDATED_EVENT, onOutdated);
    return () => window.removeEventListener(GV_API_OUTDATED_EVENT, onOutdated);
  }, []);

  if (path === null) return null;

  return (
    <div
      className="connection-banner connection-banner--update"
      role="status"
      style={{
        background: '#fffbeb',
        borderBottom: '1px solid #fcd34d',
        color: '#92400e',
      }}
    >
      <span className="connection-banner__text">
        A API do servidor está desatualizada (não conhece {path || 'rotas desta versão'}), então
        partes do sistema aparecem vazias. Reinicie o serviço da API depois do build — o sistema
        aqui está na v{APP_VERSION}.
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, APP_VERSION);
          } catch {
            /* ignore */
          }
          setPath(null);
        }}
      >
        Dispensar
      </button>
    </div>
  );
}
