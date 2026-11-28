// Presentational facet panel: source (with result counts) and catalogue number.
// Title and composer are searched with the global search box. Used in the
// desktop sidebar and inside the mobile filter drawer.
import type { Source } from '../../../api/types';
import controls from '../../../styles/controls.module.css';
import { PlannedMusicalNote } from '../../musical-metadata/components/PlannedMusicalNote';
import type { CatalogueFilters, CatalogueNumberFilter } from '../model/catalogueQuery';
import type { SourceFacetCounts } from '../model/sourceFacets';
import styles from './WorkFilters.module.css';

export type FacetCountsView =
  | { status: 'loading' }
  | { status: 'ready'; counts: SourceFacetCounts }
  | { status: 'unavailable' }
  | { status: 'error'; onRetry: () => void };

interface WorkFiltersProps {
  filters: CatalogueFilters;
  /** null while the sources are loading */
  sources: readonly Source[] | null;
  sourcesFailed: boolean;
  counts: FacetCountsView;
  onChange: (changes: Partial<CatalogueFilters>) => void;
  onClear: () => void;
  canClear: boolean;
}

const CATALOGUE_OPTIONS: ReadonlyArray<{ value: CatalogueNumberFilter; label: string }> = [
  { value: 'any', label: 'Any' },
  { value: 'with', label: 'With' },
  { value: 'without', label: 'Without' },
];

const number = new Intl.NumberFormat();

function Count({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <span className={styles.count}>
      {number.format(value)} <span className="visually-hidden">{value === 1 ? 'work' : 'works'}</span>
    </span>
  );
}

export function WorkFilters({ filters, sources, sourcesFailed, counts, onChange, onClear, canClear }: WorkFiltersProps) {
  const ready = counts.status === 'ready' ? counts.counts : null;
  const sourceOptions: ReadonlyArray<{ code: string; name: string; count: number | undefined }> = [
    { code: '', name: 'All sources', count: ready?.total },
    ...(sources ?? []).map((s) => ({ code: s.code, name: s.name, count: ready?.bySource.get(s.code) })),
    // Keep an unknown code from the URL selectable instead of silently dropping it.
    ...(sources && filters.source && !sources.some((s) => s.code === filters.source)
      ? [{ code: filters.source, name: filters.source, count: undefined }]
      : []),
  ];

  return (
    <div className={styles.panel}>
      <fieldset className={styles.group} disabled={sources === null && !sourcesFailed}>
        <legend className={styles.legend}>Source</legend>
        {sourcesFailed ? (
          <p className={styles.problem}>Sources could not be loaded.</p>
        ) : (
          <div className={styles.options}>
            {sourceOptions.map((option) => (
              <label
                key={option.code || 'all'}
                className={option.count === 0 && filters.source !== option.code ? `${styles.option} ${styles.empty}` : styles.option}
              >
                <input
                  type="radio"
                  name="filter-source"
                  value={option.code}
                  checked={filters.source === option.code}
                  onChange={() => onChange({ source: option.code })}
                />
                <span className={styles.optionName}>{option.name}</span> <Count value={option.count} />
              </label>
            ))}
          </div>
        )}
        <p className={styles.countNote} aria-live="polite">
          {counts.status === 'loading' && sources !== null && 'Counting works…'}
          {counts.status === 'ready' && 'Counts reflect your search and other filters.'}
          {counts.status === 'unavailable' && 'Counts are not shown for this many sources.'}
          {counts.status === 'error' && (
            <>
              Counts could not be loaded.{' '}
              <button type="button" className={styles.retry} onClick={counts.onRetry}>
                Retry
              </button>
            </>
          )}
        </p>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Catalogue number</legend>
        <div className={styles.segmented}>
          {CATALOGUE_OPTIONS.map((option) => (
            <label key={option.value} className={styles.segment}>
              <input
                type="radio"
                name="filter-catalogue"
                value={option.value}
                checked={filters.catalogueNumber === option.value}
                onChange={() => onChange({ catalogueNumber: option.value })}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <PlannedMusicalNote variant="facet" />

      <button type="button" className={controls.secondary} onClick={onClear} disabled={!canClear}>
        Clear filters
      </button>
    </div>
  );
}
