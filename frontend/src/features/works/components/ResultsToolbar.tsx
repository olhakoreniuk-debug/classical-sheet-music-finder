// Sort order and page size for the results list. Presentational only.
import type { WorkSort } from '../../../api/types';
import controls from '../../../styles/controls.module.css';
import { PAGE_SIZES, SORT_OPTIONS, type CatalogueFilters } from '../model/catalogueQuery';
import styles from './ResultsToolbar.module.css';

interface ResultsToolbarProps {
  filters: CatalogueFilters;
  onChange: (changes: Partial<CatalogueFilters>) => void;
}

export function ResultsToolbar({ filters, onChange }: ResultsToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.control}>
        <label className={styles.label} htmlFor="filter-sort">
          Sort by
        </label>
        <select
          id="filter-sort"
          className={controls.select}
          value={filters.sort}
          onChange={(event) => onChange({ sort: event.target.value as WorkSort })}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.control}>
        <label className={styles.label} htmlFor="filter-page-size">
          Per page
        </label>
        <select
          id="filter-page-size"
          className={controls.select}
          value={filters.pageSize}
          onChange={(event) => onChange({ pageSize: Number(event.target.value) })}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
