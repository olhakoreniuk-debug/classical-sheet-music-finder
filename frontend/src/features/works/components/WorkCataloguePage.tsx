// Catalogue page: owns the URL-based filter state and the data requests, and
// composes presentational components for facets, results and pagination.
import { useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { paths } from '../../../app/paths';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { FilterDrawer } from '../../../components/FilterDrawer';
import { LoadingState } from '../../../components/LoadingState';
import { Pagination } from '../../../components/Pagination';
import { useMediaQuery } from '../../../shared/useMediaQuery';
import controls from '../../../styles/controls.module.css';
import { useSources } from '../../sources/hooks/useSources';
import { useSourceFacetCounts } from '../hooks/useSourceFacetCounts';
import { useWorks } from '../hooks/useWorks';
import { describeActiveFilters } from '../model/activeFilters';
import {
  DEFAULT_FILTERS,
  filtersFromSearchParams,
  filtersToQuery,
  filtersToSearchParams,
  hasActiveFilters,
  pageCount,
  type CatalogueFilters,
} from '../model/catalogueQuery';
import { ActiveFilterChips } from './ActiveFilterChips';
import { ResultsToolbar } from './ResultsToolbar';
import styles from './WorkCataloguePage.module.css';
import { WorkFilters, type FacetCountsView } from './WorkFilters';
import { WorkList } from './WorkList';

/** Below this width the facets move into a drawer (matches the CSS breakpoint). */
export const COMPACT_LAYOUT_QUERY = '(max-width: 56rem)';

const number = new Intl.NumberFormat();

export function WorkCataloguePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const query = useMemo(() => filtersToQuery(filters), [filters]);
  const { state, reload } = useWorks(query);
  const sources = useSources();
  const sourceList = sources.state.status === 'success' ? sources.state.data.data : null;
  const facets = useSourceFacetCounts(filters, sourceList);
  const compact = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeFilters = describeActiveFilters(filters, sourceList);

  const updateFilters = (changes: Partial<CatalogueFilters>, options: { replace?: boolean } = {}) => {
    const next = { ...filters, ...changes };
    if (!('page' in changes)) next.page = 1;
    setSearchParams(filtersToSearchParams(next), { replace: options.replace ?? false });
  };

  const clearFilters = () => updateFilters({ ...DEFAULT_FILTERS, sort: filters.sort, pageSize: filters.pageSize });

  const page = state.status === 'success' ? state.data : state.status === 'loading' ? state.previous : null;
  const total = page?.page.total ?? null;

  const counts: FacetCountsView =
    facets.state.status === 'success'
      ? facets.state.data
        ? { status: 'ready', counts: facets.state.data }
        : { status: 'unavailable' }
      : facets.state.status === 'error'
        ? { status: 'error', onRetry: facets.reload }
        : { status: 'loading' };

  const filterPanel = (
    <WorkFilters
      filters={filters}
      sources={sourceList}
      sourcesFailed={sources.state.status === 'error'}
      counts={counts}
      onChange={updateFilters}
      onClear={clearFilters}
      canClear={hasActiveFilters(filters)}
    />
  );

  const showLabel =
    total === null || state.status !== 'success'
      ? 'Show results'
      : `Show ${number.format(total)} ${total === 1 ? 'work' : 'works'}`;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Browse the catalogue</h1>
          <p className={styles.lead}>
            {total === null ? (
              'Search by title or composer above, then narrow the results.'
            ) : (
              <>
                <strong>{number.format(total)}</strong> {total === 1 ? 'work' : 'works'}
                {hasActiveFilters(filters) ? ' match your search' : ' in the catalogue'}
              </>
            )}
          </p>
        </div>
        <Link to={paths.newWork} className={`${controls.secondary} ${styles.add}`}>
          + Add a work
        </Link>
      </header>

      <div className={styles.layout}>
        {!compact && (
          <aside className={styles.sidebar} aria-labelledby="facets-title">
            <h2 id="facets-title" className={styles.sidebarTitle}>
              Refine
            </h2>
            {filterPanel}
          </aside>
        )}

        <section aria-labelledby="results-heading" className={styles.results}>
          <h2 id="results-heading" className="visually-hidden">
            Results
          </h2>
          <div className={styles.toolbar}>
            {compact && (
              <button
                type="button"
                className={`${controls.secondary} ${styles.filtersButton}`}
                aria-haspopup="dialog"
                onClick={() => setDrawerOpen(true)}
              >
                Filters
                {activeFilters.length > 0 && (
                  <>
                    {' '}
                    <span className={styles.badge}>{activeFilters.length}</span>{' '}
                    <span className="visually-hidden">active</span>
                  </>
                )}
              </button>
            )}
            <ResultsToolbar filters={filters} onChange={updateFilters} />
          </div>

          <ActiveFilterChips filters={activeFilters} onRemove={updateFilters} onClearAll={clearFilters} />

          {state.status === 'error' && <ErrorState title="The works could not be loaded." error={state.error} onRetry={reload} />}

          {state.status === 'loading' && page === null && <LoadingState label="Loading works…" />}

          {page !== null && page.page.total === 0 && (
            <EmptyState
              title={hasActiveFilters(filters) ? 'No works match these filters.' : 'The catalogue is empty.'}
              message={
                hasActiveFilters(filters)
                  ? 'Try a different search term, switch between Title and Composer, or remove some filters.'
                  : 'No works have been imported or added yet.'
              }
              action={
                hasActiveFilters(filters) ? (
                  <button type="button" className={controls.secondary} onClick={clearFilters}>
                    Clear all filters
                  </button>
                ) : (
                  <Link to={paths.newWork}>Add the first work</Link>
                )
              }
            />
          )}

          {page !== null && page.page.total > 0 && page.data.length === 0 && (
            <EmptyState
              title="This page is empty."
              message="There are fewer results than this page number."
              action={
                <button type="button" className={controls.secondary} onClick={() => updateFilters({ page: 1 })}>
                  Go to the first page
                </button>
              }
            />
          )}

          {page !== null && page.data.length > 0 && (
            <div aria-busy={state.status === 'loading'} className={state.status === 'loading' ? styles.refreshing : undefined}>
              <div className={styles.summaryRow}>
                <p className={styles.summary} role="status" aria-live="polite">
                  Showing {page.page.offset + 1}–{page.page.offset + page.data.length} of {page.page.total}{' '}
                  {page.page.total === 1 ? 'work' : 'works'}
                </p>
                {state.status === 'loading' && <LoadingState label="Updating…" inline />}
              </div>
              <WorkList
                works={page.data}
                linkState={{ from: location.search }}
                layout="rows"
                label="Works"
                highlight={{ title: filters.q, composer: filters.composer }}
              />
              <Pagination
                page={filters.page}
                pageCount={pageCount(page.page.total, page.page.limit)}
                onPageChange={(next) => updateFilters({ page: next })}
                disabled={state.status === 'loading'}
              />
            </div>
          )}
        </section>
      </div>

      {compact && (
        <FilterDrawer
          open={drawerOpen}
          title="Filters"
          onClose={() => setDrawerOpen(false)}
          footer={
            <button type="button" className={controls.primary} onClick={() => setDrawerOpen(false)}>
              {showLabel}
            </button>
          }
        >
          {filterPanel}
        </FilterDrawer>
      )}
    </div>
  );
}
