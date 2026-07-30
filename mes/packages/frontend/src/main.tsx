import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './core/i18n';
import './core/styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element bulunamadı');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);