import styles from './StateMessage.module.css';

interface LoadingStateProps {
  label: string;
  /** Compact variant for use inside other content. */
  inline?: boolean;
}

export function LoadingState({ label, inline = false }: LoadingStateProps) {
  return (
    <div className={inline ? styles.inline : styles.panel} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
