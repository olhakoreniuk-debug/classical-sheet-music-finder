// Describes the active filters as removable chips. Pure function, no React.
import type { Source } from '../../../api/types';
import type { CatalogueFilters } from './catalogueQuery';

export interface ActiveFilter {
  key: string;
  label: string;
  /** Changes that remove this filter. */
  remove: Partial<CatalogueFilters>;
}

export function describeActiveFilters(filters: CatalogueFilters, sources: readonly Source[] | null): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  if (filters.q.trim()) active.push({ key: 'q', label: `Title contains “${filters.q.trim()}”`, remove: { q: '' } });
  if (filters.composer.trim()) {
    active.push({ key: 'composer', label: `Composer contains “${filters.composer.trim()}”`, remove: { composer: '' } });
  }
  if (filters.source) {
    const name = sources?.find((s) => s.code === filters.source)?.name ?? filters.source;
    active.push({ key: 'source', label: `Source: ${name}`, remove: { source: '' } });
  }
  if (filters.catalogueNumber !== 'any') {
    active.push({
      key: 'catalogueNumber',
      label: filters.catalogueNumber === 'with' ? 'With catalogue number' : 'Without catalogue number',
      remove: { catalogueNumber: 'any' },
    });
  }
  return active;
}
