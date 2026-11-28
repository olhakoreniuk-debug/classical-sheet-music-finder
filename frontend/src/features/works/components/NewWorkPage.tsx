import { useNavigate } from 'react-router';
import { useIsDemo } from '../../../app/ApiContext';
import { paths } from '../../../app/paths';
import type { Work } from '../../../api/types';
import { WorkForm } from './WorkForm';
import styles from './NewWorkPage.module.css';

export function NewWorkPage() {
  const navigate = useNavigate();
  const isDemo = useIsDemo();
  const showCreated = (work: Work) => navigate(paths.work(work.id), { state: { created: true } });

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>Add a work</h1>
        <p className={styles.lead}>
          Add a work that is not provided by one of the catalogue's sources. It will be listed with the source
          “Added manually”.
        </p>
        {isDemo && (
          <p className={styles.demo}>Demo mode: works you add are kept only until the page is reloaded.</p>
        )}
      </header>

      <div className={styles.layout}>
        <WorkForm onCreated={showCreated} />

        <aside className={styles.tips} aria-labelledby="form-tips">
          <h2 id="form-tips" className={styles.tipsTitle}>
            Tips for a good entry
          </h2>
          <ul>
            <li>Use the title as printed on the score, for example “Winterreise, D.911”.</li>
            <li>Write the composer's name in full: “Schubert, Franz” or “Franz Schubert”.</li>
            <li>Add a catalogue number (Op., BWV, K., D. …) if the work has one; it helps to tell versions apart.</li>
            <li>The server checks every field. If something is wrong, the form lists the problems and links to them.</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
