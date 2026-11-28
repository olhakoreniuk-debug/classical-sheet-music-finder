// The global search box searches one field at a time: the title (`q`) or the
// composer (`composer`), both existing listWorks parameters. Pure functions.
import type { CatalogueFilters } from './catalogueQuery';

export type SearchScope = 'title' | 'composer';

export const SEARCH_SCOPES: ReadonlyArray<{ value: SearchScope; label: string; placeholder: string }> = [
  { value: 'title', label: 'Title', placeholder: 'Search titles, e.g. Lied, sonata, waltz' },
  { value: 'composer', label: 'Composer', placeholder: 'Search composers, e.g. Schubert' },
];

const FIELD: Record<SearchScope, 'q' | 'composer'> = { title: 'q', composer: 'composer' };

/** The scope implied by the filters; keeps `fallback` when both or neither field is set. */
export function scopeFromFilters(filters: CatalogueFilters, fallback: SearchScope): SearchScope {
  const hasTitle = Boolean(filters.q.trim());
  const hasComposer = Boolean(filters.composer.trim());
  if (hasTitle && !hasComposer) return 'title';
  if (hasComposer && !hasTitle) return 'composer';
  return fallback;
}

export function searchTextFor(filters: CatalogueFilters, scope: SearchScope): string {
  return filters[FIELD[scope]];
}

/** Sets the searched field, keeping every other filter; returns to the first page. */
export function applySearch(filters: CatalogueFilters, scope: SearchScope, text: string): CatalogueFilters {
  return { ...filters, [FIELD[scope]]: text.trim(), page: 1 };
}

/** Moves the search text from one field to the other when the scope changes. */
export function switchScope(filters: CatalogueFilters, from: SearchScope, to: SearchScope, text: string): CatalogueFilters {
  if (from === to) return applySearch(filters, to, text);
  return applySearch({ ...filters, [FIELD[from]]: '' }, to, text);
}
