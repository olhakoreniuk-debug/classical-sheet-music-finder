import { Link } from 'react-router';
import { paths } from '../../../app/paths';
import type { Work } from '../../../api/types';
import { Highlight } from '../../../components/Highlight';
import { SourceBadge } from '../../../components/SourceBadge';
import { catalogueLabel, composerLabel } from '../model/workDisplay';
import styles from './WorkCard.module.css';

export interface SearchTerms {
  title?: string;
  composer?: string;
}

interface WorkCardProps {
  work: Work;
  linkState: { from: string };
  /** "card" for grids, "row" for result lists. */
  layout?: 'card' | 'row';
  /** Search terms to mark in the title and composer. */
  highlight?: SearchTerms;
}

export function WorkCard({ work, linkState, layout = 'card', highlight = {} }: WorkCardProps) {
  return (
    <article className={layout === 'row' ? `${styles.card} ${styles.row}` : styles.card}>
      <div className={styles.main}>
        <h3 className={styles.title}>
          <Link to={paths.work(work.id)} state={linkState} className={styles.link}>
            <Highlight text={work.title} term={highlight.title} />
          </Link>
        </h3>
        <p className={work.composer ? styles.composer : `${styles.composer} ${styles.missing}`}>
          {work.composer ? <Highlight text={work.composer.name} term={highlight.composer} /> : composerLabel(work)}
        </p>
      </div>
      <div className={styles.meta}>
        <span className={work.catalogueNumber ? styles.catalogue : `${styles.catalogue} ${styles.missing}`}>
          {catalogueLabel(work)}
        </span>
        <SourceBadge source={work.source} />
      </div>
    </article>
  );
}
