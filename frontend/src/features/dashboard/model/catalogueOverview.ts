// Everything the home page shows, derived from existing API operations.
// No figure is invented or hard-coded: totals come from page metadata.
import type { CatalogApi } from '../../../api/catalogApi';
import type { Source, Work } from '../../../api/types';
import { DEFAULT_FILTERS } from '../../works/model/catalogueQuery';
import { loadSourceFacetCounts } from '../../works/model/sourceFacets';

export const RECENT_WORKS_COUNT = 6;

export interface SourceSummary {
  source: Source;
  /** null when counts are not available (too many sources to count separately) */
  workCount: number | null;
}

export interface CatalogueOverview {
  totalWorks: number;
  worksWithCatalogueNumber: number;
  recentWorks: Work[];
  /** Sorted by number of works, largest first. */
  sources: SourceSummary[];
}

export async function loadCatalogueOverview(api: CatalogApi, signal: AbortSignal): Promise<CatalogueOverview> {
  const options = { signal };
  // The "recently added" page also carries the total number of works.
  const [recent, withCatalogueNumber, sourceList] = await Promise.all([
    api.listWorks({ sort: '-createdAt', limit: RECENT_WORKS_COUNT }, options),
    api.listWorks({ hasCatalogueNumber: true, limit: 1 }, options),
    api.listSources(options),
  ]);
  const counts = await loadSourceFacetCounts(api, DEFAULT_FILTERS, sourceList.data, signal);

  const sources = sourceList.data.map((source) => ({ source, workCount: counts?.bySource.get(source.code) ?? null }));
  sources.sort((a, b) => (b.workCount ?? -1) - (a.workCount ?? -1) || a.source.name.localeCompare(b.source.name));

  return {
    totalWorks: recent.page.total,
    worksWithCatalogueNumber: withCatalogueNumber.page.total,
    recentWorks: recent.data,
    sources,
  };
}

/** Share of a part in the whole, as a whole percentage (0 for an empty catalogue). */
export function percentage(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
