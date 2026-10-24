import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { isGestorVendDesktop } from './lib/desktop-bridge';

if (isGestorVendDesktop()) {
  document.documentElement.classList.add('gv-desktop');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
