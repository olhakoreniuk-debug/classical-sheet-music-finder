import type { Work } from '../../../api/types';
import { WorkCard, type SearchTerms } from './WorkCard';
import styles from './WorkList.module.css';

interface WorkListProps {
  works: readonly Work[];
  /** Passed to the detail page so its "Back" link restores the filters. */
  linkState: { from: string };
  layout?: 'grid' | 'rows';
  highlight?: SearchTerms;
  /** Accessible name of the list. */
  label?: string;
}

export function WorkList({ works, linkState, layout = 'grid', highlight, label }: WorkListProps) {
  return (
    <ul className={layout === 'rows' ? styles.rows : styles.grid} aria-label={label}>
      {works.map((work) => (
        <li key={work.id}>
          <WorkCard
            work={work}
            linkState={linkState}
            layout={layout === 'rows' ? 'row' : 'card'}
            {...(highlight ? { highlight } : {})}
          />
        </li>
      ))}
    </ul>
  );
}
