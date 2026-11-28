import type { ActiveFilter } from '../model/activeFilters';
import type { CatalogueFilters } from '../model/catalogueQuery';
import styles from './ActiveFilterChips.module.css';

interface ActiveFilterChipsProps {
  filters: readonly ActiveFilter[];
  onRemove: (changes: Partial<CatalogueFilters>) => void;
  onClearAll: () => void;
}

export function ActiveFilterChips({ filters, onRemove, onClearAll }: ActiveFilterChipsProps) {
  if (filters.length === 0) return null;
  return (
    <div className={styles.bar}>
      <span className={styles.caption}>Active filters:</span>
      <ul className={styles.list}>
        {filters.map((filter) => (
          <li key={filter.key}>
            <button type="button" className={styles.chip} onClick={() => onRemove(filter.remove)}>
              {filter.label}
              <span className={styles.x} aria-hidden="true">
                ×
              </span>
              <span className="visually-hidden">(remove filter)</span>
            </button>
          </li>
        ))}
      </ul>
      {filters.length > 1 && (
        <button type="button" className={styles.clear} onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
