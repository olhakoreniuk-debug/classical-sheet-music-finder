// Key figures as links into the catalogue: every number leads somewhere useful.
import { Link } from 'react-router';
import { paths } from '../../../app/paths';
import { catalogueLink } from '../../works/model/workLinks';
import { percentage, type CatalogueOverview } from '../model/catalogueOverview';
import styles from './CatalogueFacts.module.css';

const number = new Intl.NumberFormat();

export function CatalogueFacts({ overview }: { overview: CatalogueOverview }) {
  const { totalWorks, worksWithCatalogueNumber, sources } = overview;
  return (
    <ul className={styles.facts} aria-label="Catalogue at a glance">
      <li>
        <Link to={paths.catalogue} className={styles.fact}>
          <strong className={styles.value}>{number.format(totalWorks)}</strong>{' '}
          <span className={styles.label}>{totalWorks === 1 ? 'work' : 'works'}</span>
        </Link>
      </li>
      <li>
        <a href="#sources-title" className={styles.fact}>
          <strong className={styles.value}>{number.format(sources.length)}</strong>{' '}
          <span className={styles.label}>{sources.length === 1 ? 'source' : 'sources'}</span>
        </a>
      </li>
      <li>
        <Link to={catalogueLink({ catalogueNumber: 'with' })} className={styles.fact}>
          <strong className={styles.value}>{number.format(worksWithCatalogueNumber)}</strong>{' '}
          <span className={styles.label}>
            with a catalogue number ({percentage(worksWithCatalogueNumber, totalWorks)}%)
          </span>
        </Link>
      </li>
    </ul>
  );
}
