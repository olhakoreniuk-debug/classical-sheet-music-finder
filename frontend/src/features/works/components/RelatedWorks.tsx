// "More by this composer" and "More from this source" on the detail page.
import { Link } from 'react-router';
import type { Work } from '../../../api/types';
import { LoadingState } from '../../../components/LoadingState';
import { useRelatedWorks } from '../hooks/useRelatedWorks';
import { composerLink, sourceLink } from '../model/workLinks';
import styles from './RelatedWorks.module.css';
import { WorkList } from './WorkList';

export function RelatedWorks({ work }: { work: Work }) {
  const { state, reload } = useRelatedWorks(work);
  const composer = work.composer?.name;

  return (
    <section className={styles.related} aria-labelledby="related-title">
      <h2 id="related-title" className={styles.title}>
        {composer ? `More by ${composer}` : 'Explore further'}
      </h2>

      {composer && state.status === 'loading' && <LoadingState label="Loading related works…" inline />}
      {composer && state.status === 'error' && (
        <p className={styles.problem} role="alert">
          Related works could not be loaded.{' '}
          <button type="button" className={styles.retry} onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {state.status === 'success' && state.data !== null && state.data.length === 0 && (
        <p className={styles.muted}>No other works by this composer are in the catalogue yet.</p>
      )}
      {state.status === 'success' && state.data !== null && state.data.length > 0 && (
        <WorkList works={state.data} linkState={{ from: '' }} layout="rows" label={`Other works by ${composer ?? ''}`} />
      )}
      {!composer && <p className={styles.muted}>The composer of this work is unknown.</p>}

      <ul className={styles.links}>
        {composer && (
          <li>
            <Link to={composerLink(composer)}>
              All works by {composer} <span aria-hidden="true">→</span>
            </Link>
          </li>
        )}
        <li>
          <Link to={sourceLink(work.source.code)}>
            All works from {work.source.name} <span aria-hidden="true">→</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
