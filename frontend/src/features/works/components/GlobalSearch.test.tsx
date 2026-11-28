import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { CatalogApi } from '../../../api/catalogApi';
import { ApiProvider } from '../../../app/ApiContext';
import { Layout } from '../../../app/Layout';
import { createMockCatalogApi } from '../../../mock/mockCatalogApi';
import { makeWork, sourceA } from '../../../test/fixtures';
import { WorkCataloguePage } from './WorkCataloguePage';

const works = [
  makeWork(1, { title: 'Erlkönig', composer: { id: 1, name: 'Schubert, Franz' } }),
  makeWork(2, { title: 'Ständchen', composer: { id: 1, name: 'Schubert, Franz' } }),
  makeWork(3, { title: 'Liebst du um Schönheit', composer: { id: 2, name: 'Schumann, Clara' } }),
  makeWork(4, { title: 'Schubert Variations', composer: { id: 3, name: 'Liszt, Franz' } }),
];

function renderApp(initialEntry: string, api: CatalogApi = createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] })) {
  return render(
    <ApiProvider api={api} isDemo={false}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<p>Home page</p>} />
            <Route path="works" element={<WorkCataloguePage />} />
            <Route path="works/new" element={<p>New work page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('GlobalSearch', () => {
  it('is available on every page with a labelled scope', () => {
    renderApp('/works/new');
    expect(screen.getByRole('search', { name: 'Search the catalogue' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Search in' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search by title' })).toBeTruthy();
  });

  it('searches by composer from another page and opens the catalogue', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search in' }), 'composer');
    await user.type(screen.getByRole('searchbox', { name: 'Search by composer' }), 'Schubert{Enter}');
    expect(await screen.findByText('Showing 1–2 of 2 works')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Composer contains “Schubert”/ })).toBeTruthy();
  });

  it('searches titles as you type on the catalogue page', async () => {
    const user = userEvent.setup();
    renderApp('/works');
    await screen.findByText('Showing 1–4 of 4 works');
    await user.type(screen.getByRole('searchbox', { name: 'Search by title' }), 'schubert');
    expect(await screen.findByText('Showing 1–1 of 1 work')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Schubert Variations' })).toBeTruthy();
  });

  it('moves the search text to the composer field when the scope changes', async () => {
    const user = userEvent.setup();
    renderApp('/works?q=schubert');
    await screen.findByText('Showing 1–1 of 1 work');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search in' }), 'composer');
    expect(await screen.findByText('Showing 1–2 of 2 works')).toBeTruthy();
    expect((screen.getByRole('searchbox', { name: 'Search by composer' }) as HTMLInputElement).value).toBe('schubert');
  });

  it('follows the URL when a filter chip removes the search', async () => {
    const user = userEvent.setup();
    renderApp('/works?composer=schumann');
    await screen.findByText('Showing 1–1 of 1 work');
    const box = screen.getByRole('searchbox', { name: 'Search by composer' }) as HTMLInputElement;
    expect(box.value).toBe('schumann');
    await user.click(screen.getByRole('button', { name: /Composer contains “schumann”/ }));
    expect(await screen.findByText('Showing 1–4 of 4 works')).toBeTruthy();
    expect(box.value).toBe('');
  });
});
