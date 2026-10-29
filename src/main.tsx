import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { registerServiceWorker } from '@/app/pwa/serviceWorker';
import { installPromptStore } from '@/core/platform';

// PWA-01: listen for `beforeinstallprompt` from the start (it can fire before Settings exists).
installPromptStore();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA-02: production builds only (the dev server has no service worker); lazily loaded.
if (import.meta.env.PROD) void registerServiceWorker();
