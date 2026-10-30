import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { registerServiceWorker } from '@/app/pwa/serviceWorker';
import { connectivity, createOriginProbe } from '@/core/net/connectivity';
import { installPromptStore } from '@/core/platform/installPrompt';

// PWA-01: listen for `beforeinstallprompt` from the start (it can fire before Settings exists).
installPromptStore();
// PWA-04: request failures are checked against the app's own origin (connectivity store).
connectivity.setProbe(createOriginProbe(new URL(import.meta.env.BASE_URL, location.href).href));

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

// PWA-02: production builds only (the dev server has no service worker); lazily loaded, and only
// once the first screen is up (QA-04: its chunks stay off the start-up critical path).
const onStarted = import.meta.env.PROD ? () => void registerServiceWorker() : undefined;

createRoot(root).render(
  <StrictMode>
    <App onStarted={onStarted} />
  </StrictMode>,
);
