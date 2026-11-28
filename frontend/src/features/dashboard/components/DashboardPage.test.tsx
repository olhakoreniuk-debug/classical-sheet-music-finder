import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/apiError';
import type { CatalogApi } from '../../../api/catalogApi';
import { createMockCatalogApi } from '../../../mock/mockCatalogApi';
import { makeWork, manualSource, sourceA } from '../../../test/fixtures';
import { renderWithApi } from '../../../test/renderWithApi';
import { DashboardPage } from './DashboardPage';

const works = Array.from({ length: 7 }, (_, i) =>
  makeWork(i + 1, { catalogueNumber: i < 3 ? `Op. ${i + 1}` : null, createdAt: `2026-0${i + 1}-01T00:00:00Z` }),
);

describe('DashboardPage', () => {
  it('shows figures computed from the API as links with readable names', async () => {
    renderWithApi(<DashboardPage />, createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] }));
    const facts = await screen.findByRole('list', { name: 'Catalogue at a glance' });
    const links = within(facts).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['7 works', '1 source', '3 with a catalogue number (43%)']);
    expect(links[0]?.getAttribute('href')).toBe('/works');
    expect(links[2]?.getAttribute('href')).toBe('/works?catalogueNumber=with');
  });

  it('lists the most recently added works first', async () => {
    renderWithApi(<DashboardPage />, createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] }));
    const recent = await screen.findByRole('list', { name: 'Recently added works' });
    const titles = within(recent).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['Work 7', 'Work 6', 'Work 5', 'Work 4', 'Work 3', 'Work 2']);
  });

  it('links every source to the filtered catalogue with its real count', async () => {
    const mixed = [...works, makeWork(20, { source: { code: 'manual', name: 'Added manually' } })];
    renderWithApi(<DashboardPage />, createMockCatalogApi({ delayMs: 0, works: mixed, sources: [manualSource, sourceA] }));
    const sourceA7 = await screen.findByRole('link', { name: /Source A\s*7 works/ });
    expect(sourceA7.getAttribute('href')).toBe('/works?source=source-a');
    expect(screen.getByRole('link', { name: /Added manually\s*1 work/ }).getAttribute('href')).toBe('/works?source=manual');
  });

  it('presents voice and instrument search as planned, not as working filters', async () => {
    renderWithApi(<DashboardPage />, createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] }));
    expect(await screen.findByText('Coming next: search by voice and instrument')).toBeTruthy();
    expect(screen.getByText('Planned')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows an error state and recovers on retry', async () => {
    const user = userEvent.setup();
    const working = createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] });
    let fail = true;
    const flaky: CatalogApi = {
      ...working,
      listSources: (options) => (fail ? Promise.reject(ApiError.network()) : working.listSources(options)),
    };
    renderWithApi(<DashboardPage />, flaky);
    expect(await screen.findByText('The catalogue overview could not be loaded.')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Catalogue at a glance' })).toBeTruthy();
  });
});
