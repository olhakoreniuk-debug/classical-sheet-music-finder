import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/apiError';
import type { CatalogApi } from '../../../api/catalogApi';
import { createMockCatalogApi } from '../../../mock/mockCatalogApi';
import { makeWork, manualSource, sourceA } from '../../../test/fixtures';
import { renderWithApi } from '../../../test/renderWithApi';
import { COMPACT_LAYOUT_QUERY, WorkCataloguePage } from './WorkCataloguePage';

const works = Array.from({ length: 12 }, (_, i) => makeWork(i + 1, { title: `Work ${String(i + 1).padStart(2, '0')}` }));

function renderCatalogue(api: CatalogApi, initialEntry = '/works') {
  return renderWithApi(<WorkCataloguePage />, api, { path: '/works', initialEntry });
}

describe('WorkCataloguePage', () => {
  it('shows a loading state, then the first page of works with a summary', async () => {
    renderCatalogue(createMockCatalogApi({ delayMs: 5, works, sources: [sourceA] }));
    expect(screen.getByText('Loading works…')).toBeTruthy();
    expect(await screen.findByText('Showing 1–10 of 12 works')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(10);
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
  });

  it('builds the source filter from GET /sources (no provider is hard-coded)', async () => {
    renderCatalogue(createMockCatalogApi({ delayMs: 0, works, sources: [sourceA, manualSource] }));
    await screen.findByRole('radio', { name: /^Source A/ });
    const group = screen.getByRole('group', { name: 'Source' });
    const options = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.querySelector('span')?.textContent);
    expect(options).toEqual(['All sources', 'Added manually', 'Source A']);
  });

  it('shows how many works each source has for the current search', async () => {
    const mixed = [
      makeWork(1, { title: 'Lied 1' }),
      makeWork(2, { title: 'Lied 2' }),
      makeWork(3, { title: 'Sonata' }),
      makeWork(4, { title: 'Lied 4', source: { code: 'manual', name: 'Added manually' } }),
    ];
    renderCatalogue(createMockCatalogApi({ delayMs: 0, works: mixed, sources: [sourceA, manualSource] }), '/works?q=lied');
    expect(await screen.findByRole('radio', { name: 'Source A 2 works' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Added manually 1 work' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'All sources 3 works' })).toBeTruthy();
    expect(screen.getByText('Counts reflect your search and other filters.')).toBeTruthy();
  });

  it('reports facet counts that cannot be loaded and retries them', async () => {
    const user = userEvent.setup();
    const working = createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] });
    let failCounts = true;
    const api: CatalogApi = {
      ...working,
      listWorks: (query, options) =>
        failCounts && query.limit === 1 ? Promise.reject(ApiError.network()) : working.listWorks(query, options),
    };
    renderCatalogue(api);
    expect(await screen.findByText(/Counts could not be loaded/)).toBeTruthy();
    expect(screen.getByText('Showing 1–10 of 12 works')).toBeTruthy();
    failCounts = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('radio', { name: 'Source A 12 works' })).toBeTruthy();
  });

  it('filters by source and shows a removable filter chip', async () => {
    const user = userEvent.setup();
    const mixed = [...works.slice(0, 3), makeWork(50, { title: 'Manual work', source: { code: 'manual', name: 'Added manually' } })];
    renderCatalogue(createMockCatalogApi({ delayMs: 0, works: mixed, sources: [sourceA, manualSource] }));
    await screen.findByText('Showing 1–4 of 4 works');
    await user.click(await screen.findByRole('radio', { name: /^Added manually/ }));
    expect(await screen.findByText('Showing 1–1 of 1 work')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Source: Added manually/ }));
    expect(await screen.findByText('Showing 1–4 of 4 works')).toBeTruthy();
  });

  it('jumps to a numbered page', async () => {
    const user = userEvent.setup();
    renderCatalogue(createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] }));
    await screen.findByText('Showing 1–10 of 12 works');
    expect(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page');
    await user.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(await screen.findByText('Showing 11–12 of 12 works')).toBeTruthy();
  });

  it('highlights the searched title and composer text in the results', async () => {
    const data = [makeWork(1, { title: 'Ständchen', composer: { id: 9, name: 'Schubert, Franz' } })];
    renderCatalogue(createMockCatalogApi({ delayMs: 0, works: data, sources: [sourceA] }), '/works?q=dchen&composer=schu');
    await screen.findByText('Showing 1–1 of 1 work');
    const marks = Array.from(document.querySelectorAll('mark')).map((mark) => mark.textContent);
    expect(marks).toEqual(['dchen', 'Schu']);
    expect(screen.getByRole('link', { name: 'Ständchen' })).toBeTruthy();
  });

  it('labels voice and instrument search as planned, without any form controls', async () => {
    renderCatalogue(createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] }));
    await screen.findByText('Showing 1–10 of 12 works');
    expect(screen.getByText('Planned')).toBeTruthy();
    expect(screen.getByText('Voice type & instrument')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Voice type' })).toBeNull();
  });

  describe('on a narrow screen', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === COMPACT_LAYOUT_QUERY,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('opens the filters in a drawer, applies them and closes with Escape', async () => {
      const user = userEvent.setup();
      const mixed = [...works.slice(0, 3), makeWork(50, { title: 'Manual work', source: { code: 'manual', name: 'Added manually' } })];
      renderCatalogue(createMockCatalogApi({ delayMs: 0, works: mixed, sources: [sourceA, manualSource] }));
      await screen.findByText('Showing 1–4 of 4 works');
      expect(screen.queryByRole('radio')).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Filters' }));
      const drawer = screen.getByRole('dialog', { name: 'Filters' });
      await user.click(await within(drawer).findByRole('radio', { name: /^Added manually/ }));
      expect(await within(drawer).findByRole('button', { name: 'Show 1 work' })).toBeTruthy();
      await user.click(within(drawer).getByRole('button', { name: 'Show 1 work' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: 'Filters 1 active' })).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'Filters 1 active' }));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('moves to the next page', async () => {
    const user = userEvent.setup();
    renderCatalogue(createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] }));
    await screen.findByText('Showing 1–10 of 12 works');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('Showing 11–12 of 12 works')).toBeTruthy();
  });

  it('shows an empty state with a way to clear the filters', async () => {
    const user = userEvent.setup();
    renderCatalogue(createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] }), '/works?q=nomatch');
    expect(await screen.findByText('No works match these filters.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(await screen.findByText('Showing 1–10 of 12 works')).toBeTruthy();
  });

  it('shows an error state with a retry button when the API fails', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const working = createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] });
    const flaky: CatalogApi = {
      ...working,
      listWorks: (query, options) => (++calls === 1 ? Promise.reject(ApiError.network()) : working.listWorks(query, options)),
    };
    renderCatalogue(flaky);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('The works could not be loaded.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Showing 1–10 of 12 works')).toBeTruthy();
  });

  it('shows missing composers and catalogue numbers explicitly', async () => {
    const nullable = [makeWork(1, { composer: null, catalogueNumber: null })];
    renderCatalogue(createMockCatalogApi({ delayMs: 0, works: nullable, sources: [sourceA] }));
    expect(await screen.findByText('Unknown composer')).toBeTruthy();
    expect(screen.getByText('No catalogue number')).toBeTruthy();
  });
});
