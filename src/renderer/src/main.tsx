import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

async function startRenderer(): Promise<void> {
  if (import.meta.env.DEV && !window.galMusic) {
    const { installBrowserPreview } = await import('./dev/browser-preview');
    installBrowserPreview();
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void startRenderer();
