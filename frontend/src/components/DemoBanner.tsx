import styles from './DemoBanner.module.css';

/** Shown whenever the app runs on built-in demonstration data instead of the API. */
export function DemoBanner() {
  return (
    <div className={styles.banner} role="note" aria-label="Demonstration data">
      <span className={styles.tag}>Demo data</span>
      <span>
        Built-in sample records, not read from the PostgreSQL database.{' '}
        <span className={styles.extra}>Works you add last until the page is reloaded.</span>
      </span>
    </div>
  );
}
