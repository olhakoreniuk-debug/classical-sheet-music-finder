import styles from './Attribution.module.css';

/** Shows a source's required attribution text; renders nothing when there is none. */
export function Attribution({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <p className={styles.attribution}>
      <span className={styles.label}>Attribution:</span> {text}
    </p>
  );
}
