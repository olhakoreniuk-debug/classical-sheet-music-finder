import { useCatalogApi } from '../../../app/ApiContext';
import type { Source } from '../../../api/types';
import { useAsyncResource, type AsyncResource } from '../../../shared/useAsyncResource';
import type { CatalogueFilters } from '../model/catalogueQuery';
import { facetContextKey, loadSourceFacetCounts, type SourceFacetCounts } from '../model/sourceFacets';

/**
 * Source counts for the current search context. Reloads only when the context
 * (search text, composer, catalogue-number filter or source list) changes;
 * outdated requests are cancelled.
 */
export function useSourceFacetCounts(
  filters: CatalogueFilters,
  sources: readonly Source[] | null,
): AsyncResource<SourceFacetCounts | null> {
  const api = useCatalogApi();
  const key = sources ? facetContextKey(filters, sources) : 'waiting-for-sources';
  return useAsyncResource(key, (signal) =>
    sources ? loadSourceFacetCounts(api, filters, sources, signal) : new Promise<never>(() => undefined),
  );
}
