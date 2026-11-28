// States honestly that voice-type and instrument search is planned, not
// available. Contains no form controls: nothing here filters anything.
import { MUSICAL_METADATA, PREVIEW_INSTRUMENTS, PREVIEW_VOICE_TYPES } from '../model/plannedMusicalMetadata';
import styles from './PlannedMusicalNote.module.css';

function Badge() {
  return <span className={styles.badge}>Planned</span>;
}

function Explanation() {
  return (
    <>
      <p>
        The catalogue's sources do not provide voice or instrumentation data yet, so these filters are not available.
        They are part of a proposed API extension ({MUSICAL_METADATA.reference}).
      </p>
      <p className={styles.examples}>
        <strong>Voice types:</strong> {PREVIEW_VOICE_TYPES.join(', ')}.
        <br />
        <strong>Instruments:</strong> {PREVIEW_INSTRUMENTS.join(', ')}.
      </p>
    </>
  );
}

/** "facet": a collapsed row in the filter panel. "card": a short note on the home page. */
export function PlannedMusicalNote({ variant }: { variant: 'facet' | 'card' }) {
  if (MUSICAL_METADATA.available) return null;

  if (variant === 'facet') {
    return (
      <details className={styles.facet}>
        <summary className={styles.summary}>
          <span>Voice type &amp; instrument</span>
          <Badge />
        </summary>
        <div className={styles.body}>
          <Explanation />
        </div>
      </details>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="planned-music-title">
      <div className={styles.cardHeader}>
        <h2 id="planned-music-title" className={styles.cardTitle}>
          Coming next: search by voice and instrument
        </h2>
        <Badge />
      </div>
      <p>
        Singers and instrumentalists will be able to combine voice types and instruments, for example soprano with
        piano. This needs new data and API support, proposed in {MUSICAL_METADATA.reference}; it is not available yet.
      </p>
    </section>
  );
}
