// Maps the catalogue's URL (shareable, bookmarkable) to UI filters and to the
// listWorks query of the contract. Pure functions: no React, no fetching.
import type { ListWorksQuery, WorkSort } from '../../../api/types';

export const PAGE_SIZES = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 10;

export const SORT_OPTIONS: ReadonlyArray<{ value: WorkSort; label: string }> = [
  { value: 'title', label: 'Title (A–Z)' },
  { value: '-title', label: 'Title (Z–A)' },
  { value: '-createdAt', label: 'Recently added' },
  { value: 'createdAt', label: 'Oldest first' },
];

export type CatalogueNumberFilter = 'any' | 'with' | 'without';

export interface CatalogueFilters {
  q: string;
  composer: string;
  source: string;
  catalogueNumber: CatalogueNumberFilter;
  sort: WorkSort;
  pageSize: number;
  page: number;
}

export const DEFAULT_FILTERS: CatalogueFilters = {
  q: '',
  composer: '',
  source: '',
  catalogueNumber: 'any',
  sort: 'title',
  pageSize: DEFAULT_PAGE_SIZE,
  page: 1,
};

const MAX_TEXT = 200; // maxLength of q and composer in openapi.yaml

function positiveInt(text: string | null, fallback: number): number {
  if (text === null || !/^\d+$/.test(text)) return fallback;
  const value = Number(text);
  return value >= 1 ? value : fallback;
}

function isSort(value: string | null): value is WorkSort {
  return SORT_OPTIONS.some((option) => option.value === value);
}

/** Reads filters from the URL, replacing anything invalid with defaults. */
export function filtersFromSearchParams(params: URLSearchParams): CatalogueFilters {
  const pageSize = positiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE);
  const catalogueNumber = params.get('catalogueNumber');
  const sort = params.get('sort');
  return {
    q: (params.get('q') ?? '').slice(0, MAX_TEXT),
    composer: (params.get('composer') ?? '').slice(0, MAX_TEXT),
    source: params.get('source') ?? '',
    catalogueNumber: catalogueNumber === 'with' || catalogueNumber === 'without' ? catalogueNumber : 'any',
    sort: isSort(sort) ? sort : DEFAULT_FILTERS.sort,
    pageSize: (PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    page: positiveInt(params.get('page'), 1),
  };
}

/** Writes filters to the URL, leaving out default values to keep URLs short. */
export function filtersToSearchParams(filters: CatalogueFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.composer.trim()) params.set('composer', filters.composer.trim());
  if (filters.source) params.set('source', filters.source);
  if (filters.catalogueNumber !== 'any') params.set('catalogueNumber', filters.catalogueNumber);
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(filters.pageSize));
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}

/** Builds the listWorks query; only defined parameters are sent (the API rejects unknown ones). */
export function filtersToQuery(filters: CatalogueFilters): ListWorksQuery {
  const query: ListWorksQuery = {
    sort: filters.sort,
    limit: filters.pageSize,
    offset: (filters.page - 1) * filters.pageSize,
  };
  const q = filters.q.trim();
  const composer = filters.composer.trim();
  if (q) query.q = q;
  if (composer) query.composer = composer;
  if (filters.source) query.source = filters.source;
  if (filters.catalogueNumber !== 'any') query.hasCatalogueNumber = filters.catalogueNumber === 'with';
  return query;
}

export function hasActiveFilters(filters: CatalogueFilters): boolean {
  return Boolean(filters.q.trim() || filters.composer.trim() || filters.source || filters.catalogueNumber !== 'any');
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
