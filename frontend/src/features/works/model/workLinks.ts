// Catalogue URLs for discovery links (composer, source). Reuses the
// catalogue's own URL format so links and filters never drift apart.
import { paths } from '../../../app/paths';
import { DEFAULT_FILTERS, filtersToSearchParams, type CatalogueFilters } from './catalogueQuery';

export function catalogueLink(changes: Partial<CatalogueFilters>): string {
  const search = filtersToSearchParams({ ...DEFAULT_FILTERS, ...changes }).toString();
  return search ? `${paths.catalogue}?${search}` : paths.catalogue;
}

export const composerLink = (name: string) => catalogueLink({ composer: name });
export const sourceLink = (code: string) => catalogueLink({ source: code });
