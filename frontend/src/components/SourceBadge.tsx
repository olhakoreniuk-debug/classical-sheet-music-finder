import type { SourceReference } from '../api/types';
import styles from './SourceBadge.module.css';

/** Shows which source a work comes from. Works for any source returned by the API. */
export function SourceBadge({ source }: { source: SourceReference }) {
  return (
    <span className={styles.badge} title={`Source: ${source.name}`}>
      <span className="visually-hidden">Source: </span>
      {source.name}
    </span>
  );
}
