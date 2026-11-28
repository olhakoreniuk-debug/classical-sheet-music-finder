// Application logic of the global search box, kept out of the component.
// On the catalogue page the box is bound to the URL and searches as you type;
// elsewhere, submitting opens the catalogue with the search applied.
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { paths } from '../../../app/paths';
import { useDebouncedValue } from '../../../shared/useDebouncedValue';
import { DEFAULT_FILTERS, filtersFromSearchParams, filtersToSearchParams, type CatalogueFilters } from '../model/catalogueQuery';
import { applySearch, scopeFromFilters, searchTextFor, switchScope, type SearchScope } from '../model/searchScope';

const TYPING_DELAY_MS = 350;

function catalogueUrl(filters: CatalogueFilters): string {
  const search = filtersToSearchParams(filters).toString();
  return search ? `${paths.catalogue}?${search}` : paths.catalogue;
}

export interface GlobalSearch {
  scope: SearchScope;
  text: string;
  setText: (text: string) => void;
  setScope: (scope: SearchScope) => void;
  submit: () => void;
}

export function useGlobalSearch(): GlobalSearch {
  const location = useLocation();
  const navigate = useNavigate();
  const onCatalogue = location.pathname === paths.catalogue;
  const urlFilters = useMemo(
    () => (onCatalogue ? filtersFromSearchParams(new URLSearchParams(location.search)) : null),
    [onCatalogue, location.search],
  );

  const [scope, setScopeState] = useState<SearchScope>(() => (urlFilters ? scopeFromFilters(urlFilters, 'title') : 'title'));
  const [text, setText] = useState(() => (urlFilters ? searchTextFor(urlFilters, scope) : ''));
  const debouncedText = useDebouncedValue(text, TYPING_DELAY_MS);

  // Follow the URL on the catalogue (back button, removed filter chips, "Clear filters").
  useEffect(() => {
    if (!urlFilters) return;
    const nextScope = scopeFromFilters(urlFilters, scope);
    setScopeState(nextScope);
    setText(searchTextFor(urlFilters, nextScope));
    // Only URL changes should re-sync; the current scope is just the fallback.
  }, [urlFilters]);

  // Search as you type on the catalogue page.
  useEffect(() => {
    if (!urlFilters || debouncedText.trim() === searchTextFor(urlFilters, scope).trim()) return;
    navigate(catalogueUrl(applySearch(urlFilters, scope, debouncedText)), { replace: true });
  }, [debouncedText]);

  const setScope = (next: SearchScope) => {
    if (urlFilters && text.trim()) navigate(catalogueUrl(switchScope(urlFilters, scope, next, text)), { replace: true });
    setScopeState(next);
  };

  const submit = () => navigate(catalogueUrl(applySearch(urlFilters ?? DEFAULT_FILTERS, scope, text)));

  return { scope, text, setText, setScope, submit };
}
