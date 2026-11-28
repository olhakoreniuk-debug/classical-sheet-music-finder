// Result counts per source for the current search context, built from the
// existing listWorks operation (one `limit=1` request per source; the total
// comes from the page metadata). The contract has no facets endpoint yet.
//
// Request growth is bounded:
// - counts are only requested for up to MAX_FACET_SOURCES sources; beyond that
//   they are reported as unavailable (an API-level facets endpoint would be needed);
// - at most FACET_CONCURRENCY requests run at the same time;
// - the context key ignores source, sort and page, so changing those reuses the counts.
import type { CatalogApi } from '../../../api/catalogApi';
import type { Source } from '../../../api/types';
import { mapWithConcurrency } from '../../../shared/mapWithConcurrency';
import { filtersToQuery, type CatalogueFilters } from './catalogueQuery';

export const MAX_FACET_SOURCES = 8;
export const FACET_CONCURRENCY = 3;

export interface SourceFacetCounts {
  /** works per source code */
  bySource: ReadonlyMap<string, number>;
  /** all sources together (every work has exactly one source) */
  total: number;
}

/** The filters that determine the counts: everything except the source facet itself, sort and paging. */
export function facetContext(filters: CatalogueFilters): CatalogueFilters {
  return { ...filters, source: '', page: 1 };
}

export function facetContextKey(filters: CatalogueFilters, sources: readonly Source[]): string {
  const { q, composer, catalogueNumber } = facetContext(filters);
  return JSON.stringify({ q: q.trim(), composer: composer.trim(), catalogueNumber, sources: sources.map((s) => s.code) });
}

/** Returns null when there are too many sources to count with separate requests. */
export async function loadSourceFacetCounts(
  api: CatalogApi,
  filters: CatalogueFilters,
  sources: readonly Source[],
  signal: AbortSignal,
): Promise<SourceFacetCounts | null> {
  if (sources.length > MAX_FACET_SOURCES) return null;
  const { sort: _sort, offset: _offset, ...base } = filtersToQuery(facetContext(filters));
  const totals = await mapWithConcurrency(
    sources,
    FACET_CONCURRENCY,
    async (source) => (await api.listWorks({ ...base, source: source.code, limit: 1 }, { signal })).page.total,
    signal,
  );
  const bySource = new Map(sources.map((source, index) => [source.code, totals[index] ?? 0]));
  return { bySource, total: totals.reduce((sum, n) => sum + n, 0) };
}
