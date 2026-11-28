import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filtersFromSearchParams,
  filtersToQuery,
  filtersToSearchParams,
  hasActiveFilters,
  pageCount,
} from './catalogueQuery';

describe('catalogue query mapping', () => {
  it('reads defaults from an empty URL', () => {
    expect(filtersFromSearchParams(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });

  it('replaces invalid URL values with defaults', () => {
    const filters = filtersFromSearchParams(
      new URLSearchParams('sort=bogus&pageSize=7&page=-2&catalogueNumber=maybe'),
    );
    expect(filters.sort).toBe('title');
    expect(filters.pageSize).toBe(10);
    expect(filters.page).toBe(1);
    expect(filters.catalogueNumber).toBe('any');
  });

  it('round-trips filters through the URL and omits defaults', () => {
    const filters = { ...DEFAULT_FILTERS, q: 'waltz', source: 'imslp', catalogueNumber: 'with' as const, page: 3 };
    const params = filtersToSearchParams(filters);
    expect(params.toString()).toBe('q=waltz&source=imslp&catalogueNumber=with&page=3');
    expect(filtersFromSearchParams(params)).toEqual(filters);
  });

  it('builds a listWorks query with only defined parameters', () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toEqual({ sort: 'title', limit: 10, offset: 0 });
    expect(
      filtersToQuery({ ...DEFAULT_FILTERS, q: '  sonata ', composer: ' ', catalogueNumber: 'without', page: 2, pageSize: 20 }),
    ).toEqual({ sort: 'title', limit: 20, offset: 20, q: 'sonata', hasCatalogueNumber: false });
  });

  it('detects active filters and computes page counts', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, composer: 'bach' })).toBe(true);
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(21, 10)).toBe(3);
  });
});
