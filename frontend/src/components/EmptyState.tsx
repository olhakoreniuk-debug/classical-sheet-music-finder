import type { ReactNode } from 'react';
import styles from './StateMessage.module.css';

interface EmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
}

export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className={styles.panel} role="status">
      <span className={styles.icon} aria-hidden="true">
        𝄐
      </span>
      <p className={styles.title}>{title}</p>
      <p className={styles.message}>{message}</p>
      {action}
    </div>
  );
}
