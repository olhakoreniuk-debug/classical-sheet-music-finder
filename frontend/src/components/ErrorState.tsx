import type { ReactNode } from 'react';
import { describeError } from '../api/apiError';
import controls from '../styles/controls.module.css';
import styles from './StateMessage.module.css';

interface ErrorStateProps {
  title: string;
  error: unknown;
  onRetry?: () => void;
  action?: ReactNode;
}

export function ErrorState({ title, error, onRetry, action }: ErrorStateProps) {
  return (
    <div className={styles.error} role="alert">
      <span className={styles.icon} aria-hidden="true">
        ⚠
      </span>
      <p className={styles.title}>{title}</p>
      <p className={styles.message}>{describeError(error)}</p>
      {onRetry && (
        <button type="button" className={controls.secondary} onClick={onRetry}>
          Try again
        </button>
      )}
      {action}
    </div>
  );
}
