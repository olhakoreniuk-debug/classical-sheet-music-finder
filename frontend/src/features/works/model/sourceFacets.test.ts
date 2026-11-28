import { describe, expect, it, vi } from 'vitest';
import type { Source } from '../../../api/types';
import { createMockCatalogApi } from '../../../mock/mockCatalogApi';
import { makeWork, manualSource, sourceA } from '../../../test/fixtures';
import { DEFAULT_FILTERS } from './catalogueQuery';
import { facetContextKey, loadSourceFacetCounts, MAX_FACET_SOURCES } from './sourceFacets';

const manualRef = { code: 'manual', name: 'Added manually' };
const works = [
  makeWork(1, { title: 'Lied 1' }),
  makeWork(2, { title: 'Sonata' }),
  makeWork(3, { title: 'Lied 3', source: manualRef }),
];
const signal = () => new AbortController().signal;

describe('loadSourceFacetCounts', () => {
  it('counts works per source in the current search context, ignoring the selected source', async () => {
    const api = createMockCatalogApi({ delayMs: 0, works, sources: [sourceA, manualSource] });
    const counts = await loadSourceFacetCounts(api, { ...DEFAULT_FILTERS, q: 'lied', source: 'manual' }, [sourceA, manualSource], signal());
    expect(counts?.bySource.get('source-a')).toBe(1);
    expect(counts?.bySource.get('manual')).toBe(1);
    expect(counts?.total).toBe(2);
  });

  it('sends one small request per source with only contract parameters', async () => {
    const api = createMockCatalogApi({ delayMs: 0, works, sources: [sourceA, manualSource] });
    const spy = vi.spyOn(api, 'listWorks');
    await loadSourceFacetCounts(api, { ...DEFAULT_FILTERS, composer: 'Composer', sort: '-title', page: 4 }, [sourceA, manualSource], signal());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map((call) => call[0])).toEqual([
      { composer: 'Composer', source: 'source-a', limit: 1 },
      { composer: 'Composer', source: 'manual', limit: 1 },
    ]);
  });

  it('does not send requests when there are too many sources', async () => {
    const api = createMockCatalogApi({ delayMs: 0, works });
    const spy = vi.spyOn(api, 'listWorks');
    const many: Source[] = Array.from({ length: MAX_FACET_SOURCES + 1 }, (_, i) => ({ ...sourceA, code: `s${i}` }));
    expect(await loadSourceFacetCounts(api, DEFAULT_FILTERS, many, signal())).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the same context key when only source, sort or page change', () => {
    const base = { ...DEFAULT_FILTERS, q: 'lied' };
    const key = facetContextKey(base, [sourceA]);
    expect(facetContextKey({ ...base, source: 'source-a', sort: '-title', page: 3 }, [sourceA])).toBe(key);
    expect(facetContextKey({ ...base, q: 'sonata' }, [sourceA])).not.toBe(key);
  });

  it('stops when the request is cancelled', async () => {
    const api = createMockCatalogApi({ delayMs: 0, works, sources: [sourceA] });
    const controller = new AbortController();
    controller.abort();
    await expect(loadSourceFacetCounts(api, DEFAULT_FILTERS, [sourceA, manualSource], controller.signal)).rejects.toThrow();
  });
});
