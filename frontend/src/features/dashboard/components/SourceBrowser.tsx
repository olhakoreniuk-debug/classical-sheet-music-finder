// Browse by source: each source with its share of the catalogue, linking to
// the filtered catalogue. Sources come from GET /sources; none is hard-coded.
import { Link } from 'react-router';
import { sourceLink } from '../../works/model/workLinks';
import { percentage, type SourceSummary } from '../model/catalogueOverview';
import styles from './SourceBrowser.module.css';

const number = new Intl.NumberFormat();

export function SourceBrowser({ sources, totalWorks }: { sources: readonly SourceSummary[]; totalWorks: number }) {
  if (sources.length === 0) return <p className={styles.muted}>No sources are configured.</p>;
  return (
    <ul className={styles.list}>
      {sources.map(({ source, workCount }) => {
        const share = workCount === null ? null : percentage(workCount, totalWorks);
        return (
          <li key={source.code}>
            <Link to={sourceLink(source.code)} className={styles.item}>
              <span className={styles.top}>
                <span className={styles.name}>{source.name}</span>
                {workCount !== null && (
                  <span className={styles.count}>
                    {number.format(workCount)} {workCount === 1 ? 'work' : 'works'}
                  </span>
                )}
              </span>
              {share !== null && (
                <span className={styles.bar} aria-hidden="true">
                  <span className={styles.fill} style={{ width: `${Math.max(share, workCount ? 2 : 0)}%` }} />
                </span>
              )}
              {source.metadataLicence && <span className={styles.meta}>Metadata licence: {source.metadataLicence}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
