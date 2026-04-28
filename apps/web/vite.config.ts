import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  /** Onde o Nest está ouvindo (proxy /api → esta URL). Sobrescreva em apps/web/.env.local */
  /** 127.0.0.1 evita 502 no Windows quando "localhost" resolve para ::1 e a API só escuta IPv4 */
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
        proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          /** Encaminha erros do alvo (evita 502 silencioso em alguns setups) */
          configure(proxy) {
            proxy.on('error', (err) => {
              // eslint-disable-next-line no-console
              console.error('[vite proxy /api] não alcançou', apiTarget, err.message);
            });
          },
        },
      },
    },
  };
});
