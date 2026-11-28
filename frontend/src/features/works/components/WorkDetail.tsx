// Presentational view of one work. Every nullable field is shown explicitly.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Work } from '../../../api/types';
import { Attribution } from '../../../components/Attribution';
import { SourceBadge } from '../../../components/SourceBadge';
import { formatDateTime } from '../../../shared/format';
import { MUSICAL_METADATA } from '../../musical-metadata/model/plannedMusicalMetadata';
import { composerLink, sourceLink } from '../model/workLinks';
import styles from './WorkDetail.module.css';

function Missing({ children }: { children: ReactNode }) {
  return <span className={styles.missing}>{children}</span>;
}

export function WorkDetail({ work }: { work: Work }) {
  return (
    <article className={styles.work} aria-labelledby="work-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>
          <span>Work</span>
          <SourceBadge source={work.source} />
        </p>
        <h1 id="work-title" className={styles.title}>
          {work.title}
        </h1>
        <p className={styles.composer}>
          {work.composer ? (
            <Link to={composerLink(work.composer.name)} className={styles.composerLink} title="All works by this composer">
              {work.composer.name}
            </Link>
          ) : (
            <Missing>Unknown composer</Missing>
          )}
        </p>
        <div className={styles.rule} aria-hidden="true" />
      </header>

      <div className={styles.body}>
        <section className={styles.main} aria-labelledby="work-facts">
          <h2 id="work-facts" className={styles.sectionTitle}>
            About this work
          </h2>
          <dl className={styles.facts}>
            <div>
              <dt>Catalogue number</dt>
              <dd className={styles.catalogue}>{work.catalogueNumber ?? <Missing>None recorded</Missing>}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                <Link to={sourceLink(work.source.code)}>{work.source.name}</Link>
              </dd>
            </div>
            <div>
              <dt>Page at the source</dt>
              <dd>
                {work.pageUrl ? (
                  <a href={work.pageUrl} target="_blank" rel="noopener noreferrer" className={styles.external}>
                    Open the work's page at {work.source.name}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                    <span aria-hidden="true"> ↗</span>
                  </a>
                ) : (
                  <Missing>No link available</Missing>
                )}
              </dd>
            </div>
            <div>
              <dt>Record id at the source</dt>
              <dd>
                <code className={styles.code}>{work.sourceRecordId}</code>
              </dd>
            </div>
          </dl>

          {!MUSICAL_METADATA.available && (
            <aside className={styles.planned} aria-labelledby="work-musical">
              <div className={styles.plannedHeader}>
                <h2 id="work-musical" className={styles.sectionTitle}>
                  Voice type &amp; instrumentation
                </h2>
                <span className={styles.badge}>Planned</span>
              </div>
              <p>Not yet available: no voice or instrument data is recorded for works ({MUSICAL_METADATA.reference}).</p>
            </aside>
          )}
        </section>

        <aside className={styles.side} aria-label="Record details">
          <dl className={styles.record}>
            <div>
              <dt>Added</dt>
              <dd>
                <time dateTime={work.createdAt}>{formatDateTime(work.createdAt)}</time>
              </dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>
                <time dateTime={work.updatedAt}>{formatDateTime(work.updatedAt)}</time>
              </dd>
            </div>
          </dl>
          <Attribution text={work.attribution} />
        </aside>
      </div>
    </article>
  );
}
