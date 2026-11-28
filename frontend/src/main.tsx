import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiProvider } from './app/ApiContext';
import { App } from './app/App';
import { createCatalogApi } from './app/createCatalogApi';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

const { api, isDemo } = await createCatalogApi();

createRoot(container).render(
  <StrictMode>
    <ApiProvider api={api} isDemo={isDemo}>
      <App />
    </ApiProvider>
  </StrictMode>,
);
