import { useSources } from '../hooks/useSources';
import styles from './SourcesFooter.module.css';

/** Credits every external source, using the attribution texts from GET /sources. */
export function SourcesFooter() {
  const { state } = useSources();
  const credited = state.status === 'success' ? state.data.data.filter((s) => s.attribution !== null) : [];

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.title}>Data sources</p>
        {credited.length > 0 ? (
          <ul className={styles.list}>
            {credited.map((source) => (
              <li key={source.code}>
                {source.homepageUrl ? (
                  <a href={source.homepageUrl} target="_blank" rel="noopener noreferrer">
                    {source.name}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                ) : (
                  source.name
                )}
                : {source.attribution}
                {source.metadataLicence && <> Licence: {source.metadataLicence}.</>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Source information is not available right now.</p>
        )}
      </div>
    </footer>
  );
}
