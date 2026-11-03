import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDesktopInputUnlock } from './lib/desktop-input-unlock';

installDesktopInputUnlock();

const rootEl = document.getElementById('root')!;

async function boot() {
  const path = window.location.pathname;
  if (path.startsWith('/delivery')) {
    const { DeliveryRoot } = await import('./delivery/DeliveryRoot');
    createRoot(rootEl).render(
      <StrictMode>
        <DeliveryRoot />
      </StrictMode>,
    );
    return;
  }
  const { default: App } = await import('./App.tsx');
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
