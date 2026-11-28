import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockCatalogApi } from '../../../mock/mockCatalogApi';
import { makeWork } from '../../../test/fixtures';
import { renderWithApi } from '../../../test/renderWithApi';
import { WorkDetailPage } from './WorkDetailPage';

function renderDetail(initialEntry: string, works = [makeWork(7)]) {
  return renderWithApi(<WorkDetailPage />, createMockCatalogApi({ delayMs: 0, works }), {
    path: '/works/:workId',
    initialEntry,
  });
}

describe('WorkDetailPage', () => {
  it('shows a work with its source, link and attribution', async () => {
    renderDetail('/works/7');
    expect(await screen.findByRole('heading', { level: 1, name: 'Work 7' })).toBeTruthy();
    expect(screen.getByText('Composer 7')).toBeTruthy();
    expect(screen.getByText('Op. 7')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the work's page at Source A/ }).getAttribute('href')).toBe(
      'https://a.example/works/7',
    );
    expect(screen.getByText('Data from Source A.')).toBeTruthy();
  });

  it('shows nullable fields explicitly and no attribution when there is none', async () => {
    renderDetail('/works/8', [
      makeWork(8, { composer: null, catalogueNumber: null, pageUrl: null, attribution: null }),
    ]);
    expect(await screen.findByText('Unknown composer')).toBeTruthy();
    expect(screen.getByText('None recorded')).toBeTruthy();
    expect(screen.getByText('No link available')).toBeTruthy();
    expect(screen.queryByText(/Attribution:/)).toBeNull();
  });

  it('shows a not-found state for an unknown id (404)', async () => {
    renderDetail('/works/999');
    expect(await screen.findByText('There is no work with id 999.')).toBeTruthy();
  });

  it('rejects an invalid id without calling the API', () => {
    renderDetail('/works/abc');
    expect(screen.getByText('This is not a valid work address.')).toBeTruthy();
  });

  it('links to related works by the same composer and from the same source', async () => {
    const bach = { id: 50, name: 'Bach, Johann Sebastian' };
    renderDetail('/works/7', [
      makeWork(7, { title: 'Partita', composer: bach }),
      makeWork(8, { title: 'Chaconne', composer: bach }),
      makeWork(9, { title: 'Goldberg Variations', composer: bach }),
      makeWork(10, { title: 'Erlkönig' }),
    ]);
    const list = await screen.findByRole('list', { name: 'Other works by Bach, Johann Sebastian' });
    const titles = within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['Chaconne', 'Goldberg Variations']);
    expect(screen.getByRole('link', { name: 'Bach, Johann Sebastian' }).getAttribute('href')).toBe(
      '/works?composer=Bach%2C+Johann+Sebastian',
    );
    expect(screen.getByRole('link', { name: /All works from Source A/ }).getAttribute('href')).toBe('/works?source=source-a');
  });

  it('does not request related works when the composer is unknown', async () => {
    renderDetail('/works/8', [makeWork(8, { composer: null })]);
    expect(await screen.findByText('The composer of this work is unknown.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /More by/ })).toBeNull();
  });
});
