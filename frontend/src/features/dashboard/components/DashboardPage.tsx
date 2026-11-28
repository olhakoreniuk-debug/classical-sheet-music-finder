// Home page: a compact introduction, then real catalogue data straight away:
// linked key figures, the most recently added works and browsing by source.
import { Link } from 'react-router';
import { paths } from '../../../app/paths';
import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { PlannedMusicalNote } from '../../musical-metadata/components/PlannedMusicalNote';
import { WorkList } from '../../works/components/WorkList';
import { catalogueLink } from '../../works/model/workLinks';
import { useCatalogueOverview } from '../hooks/useCatalogueOverview';
import { CatalogueFacts } from './CatalogueFacts';
import styles from './DashboardPage.module.css';
import { SourceBrowser } from './SourceBrowser';

export function DashboardPage() {
  const { state, reload } = useCatalogueOverview();

  return (
    <div className={styles.page}>
      <section className={styles.intro} aria-labelledby="home-title">
        <div className={styles.introText}>
          <h1 id="home-title" className={styles.title}>
            Find classical sheet music
          </h1>
          <p className={styles.lead}>
            Search works from open music libraries by title or composer, see where each record comes from, and follow it
            to its source.
          </p>
        </div>
        {state.status === 'success' && <CatalogueFacts overview={state.data} />}
      </section>

      {state.status === 'error' && (
        <ErrorState title="The catalogue overview could not be loaded." error={state.error} onRetry={reload} />
      )}
      {state.status === 'loading' && state.previous === null && <LoadingState label="Loading the catalogue overview…" />}

      {state.status === 'success' && (
        <div className={styles.columns}>
          <section aria-labelledby="recent-title" className={styles.recent}>
            <div className={styles.sectionHead}>
              <h2 id="recent-title" className={styles.sectionTitle}>
                Recently added
              </h2>
              <Link to={catalogueLink({ sort: '-createdAt' })} className={styles.more}>
                View all <span aria-hidden="true">→</span>
              </Link>
            </div>
            {state.data.recentWorks.length > 0 ? (
              <WorkList works={state.data.recentWorks} linkState={{ from: '' }} layout="rows" label="Recently added works" />
            ) : (
              <p className={styles.muted}>
                No works have been added yet. <Link to={paths.newWork}>Add the first work</Link>
              </p>
            )}
          </section>

          <aside className={styles.side} aria-label="Browse">
            <section aria-labelledby="sources-title">
              <div className={styles.sectionHead}>
                <h2 id="sources-title" className={styles.sectionTitle} tabIndex={-1}>
                  Browse by source
                </h2>
              </div>
              <SourceBrowser sources={state.data.sources} totalWorks={state.data.totalWorks} />
            </section>
            <PlannedMusicalNote variant="card" />
          </aside>
        </div>
      )}
    </div>
  );
}
