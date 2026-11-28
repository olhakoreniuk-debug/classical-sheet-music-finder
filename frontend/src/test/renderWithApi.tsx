// Renders UI with an injected CatalogApi (the same port the app uses) and a router.
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { CatalogApi } from '../api/catalogApi';
import { ApiProvider } from '../app/ApiContext';

interface Options {
  path?: string;
  initialEntry?: string;
  isDemo?: boolean;
}

export function renderWithApi(ui: ReactNode, api: CatalogApi, options: Options = {}) {
  const { path = '*', initialEntry = '/', isDemo = false } = options;
  return render(
    <ApiProvider api={api} isDemo={isDemo}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="/works/:workId" element={<p>Detail page</p>} />
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  );
}
