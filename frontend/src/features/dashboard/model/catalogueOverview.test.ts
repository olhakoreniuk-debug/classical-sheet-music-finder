import { describe, expect, it, vi } from 'vitest';
import { createMockCatalogApi } from '../../../mock/mockCatalogApi';
import { makeWork, manualSource, sourceA } from '../../../test/fixtures';
import { loadCatalogueOverview, percentage } from './catalogueOverview';

const manualRef = { code: 'manual', name: 'Added manually' };

describe('loadCatalogueOverview', () => {
  it('derives every figure from API responses', async () => {
    const works = [
      makeWork(1, { createdAt: '2026-01-01T00:00:00Z' }),
      makeWork(2, { catalogueNumber: null, createdAt: '2026-03-01T00:00:00Z' }),
      makeWork(3, { source: manualRef, createdAt: '2026-02-01T00:00:00Z' }),
    ];
    const api = createMockCatalogApi({ delayMs: 0, works, sources: [manualSource, sourceA] });
    const overview = await loadCatalogueOverview(api, new AbortController().signal);

    expect(overview.totalWorks).toBe(3);
    expect(overview.worksWithCatalogueNumber).toBe(2);
    expect(overview.recentWorks.map((w) => w.id)).toEqual([2, 3, 1]);
    expect(overview.sources.map((s) => [s.source.code, s.workCount])).toEqual([
      ['source-a', 2],
      ['manual', 1],
    ]);
    expect(percentage(overview.worksWithCatalogueNumber, overview.totalWorks)).toBe(67);
  });

  it('uses a bounded number of requests (3 + one per source)', async () => {
    const api = createMockCatalogApi({ delayMs: 0, works: [makeWork(1)], sources: [manualSource, sourceA] });
    const listWorks = vi.spyOn(api, 'listWorks');
    await loadCatalogueOverview(api, new AbortController().signal);
    expect(listWorks).toHaveBeenCalledTimes(4);
  });

  it('handles an empty catalogue without dividing by zero', async () => {
    const api = createMockCatalogApi({ delayMs: 0, works: [], sources: [sourceA] });
    const overview = await loadCatalogueOverview(api, new AbortController().signal);
    expect(overview.totalWorks).toBe(0);
    expect(overview.recentWorks).toEqual([]);
    expect(percentage(0, 0)).toBe(0);
  });
});
