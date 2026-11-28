import styles from './Pagination.module.css';

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

/** Page numbers to show: first, last, and a window around the current page; null marks a gap. */
export function pageWindow(page: number, pageCount: number, radius = 1): Array<number | null> {
  const pages: Array<number | null> = [];
  for (let n = 1; n <= pageCount; n++) {
    const near = Math.abs(n - page) <= radius;
    if (n === 1 || n === pageCount || near) pages.push(n);
    else if (pages[pages.length - 1] !== null) pages.push(null);
  }
  return pages;
}

export function Pagination({ page, pageCount, onPageChange, disabled = false }: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <button
        type="button"
        className={styles.step}
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || page <= 1}
      >
        <span aria-hidden="true">←</span> Previous
      </button>

      <ol className={styles.numbers}>
        {pageWindow(page, pageCount).map((n, index) =>
          n === null ? (
            <li key={`gap-${index}`} className={styles.gap} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={n}>
              <button
                type="button"
                className={n === page ? `${styles.number} ${styles.current}` : styles.number}
                aria-current={n === page ? 'page' : undefined}
                aria-label={`Page ${n}`}
                onClick={() => onPageChange(n)}
                disabled={disabled && n !== page}
              >
                {n}
              </button>
            </li>
          ),
        )}
      </ol>

      <span className={styles.position}>
        Page {page} of {pageCount}
      </span>

      <button
        type="button"
        className={styles.step}
        onClick={() => onPageChange(page + 1)}
        disabled={disabled || page >= pageCount}
      >
        Next <span aria-hidden="true">→</span>
      </button>
    </nav>
  );
}
