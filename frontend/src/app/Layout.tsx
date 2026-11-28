import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { DemoBanner } from '../components/DemoBanner';
import { MusicalBackdrop, TREBLE_CLEF_PATH } from '../components/MusicalBackdrop';
import { SourcesFooter } from '../features/sources/components/SourcesFooter';
import { GlobalSearch } from '../features/works/components/GlobalSearch';
import { useIsDemo } from './ApiContext';
import styles from './Layout.module.css';
import { paths } from './paths';

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink;

export function Layout() {
  const isDemo = useIsDemo();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const previousPathname = useRef(pathname);

  // Move focus to the new page's content after navigation (screen readers and keyboards).
  // Compares with the previous path, so the initial load (and StrictMode's double effect) does not steal focus.
  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className={styles.shell}>
      <MusicalBackdrop />
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to={paths.home} className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              <svg viewBox="0 0 40 100" width="14" height="22" focusable="false">
                <path d={TREBLE_CLEF_PATH} />
              </svg>
            </span>
            <span className={styles.brandText}>
              <span className={styles.brandName}>Classical Sheet Music</span>
              <span className={styles.brandSub}>Finder</span>
            </span>
          </Link>
          <div className={styles.search}>
            <GlobalSearch />
          </div>
          <nav aria-label="Main" className={styles.nav}>
            <ul className={styles.navList}>
              <li>
                <NavLink to={paths.home} end className={navClass}>
                  Home
                </NavLink>
              </li>
              <li>
                <NavLink to={paths.catalogue} end className={navClass}>
                  Browse
                </NavLink>
              </li>
              <li>
                <NavLink to={paths.newWork} className={navClass}>
                  <span>
                    Add <span className={styles.navLong}>a work</span>
                  </span>
                </NavLink>
              </li>
            </ul>
          </nav>
        </div>
        {isDemo && <DemoBanner />}
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
      <SourcesFooter />
    </div>
  );
}
