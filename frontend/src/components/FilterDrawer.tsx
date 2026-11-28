// A modal side drawer built on the native <dialog> element: the browser
// provides the focus trap, Escape to close and the inert background.
import { useEffect, useRef, type ReactNode } from 'react';
import styles from './FilterDrawer.module.css';

interface FilterDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}

export function FilterDrawer({ open, title, onClose, children, footer }: FilterDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Escape (the native "cancel" event, or a keydown where showModal is missing)
  // and clicks on the backdrop, which target the dialog element itself.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const close = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(event);
    };
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog) onCloseRef.current();
    };
    dialog.addEventListener('cancel', close);
    dialog.addEventListener('keydown', onKey);
    dialog.addEventListener('click', onClick);
    return () => {
      dialog.removeEventListener('cancel', close);
      dialog.removeEventListener('keydown', onKey);
      dialog.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // jsdom and very old browsers lack showModal(); fall back to a plain open dialog.
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
        dialog.querySelector<HTMLElement>('button, [href], input, select')?.focus();
      }
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      returnFocusRef.current?.focus();
    }
  }, [open]);

  return (
    <dialog ref={dialogRef} className={styles.drawer} aria-labelledby="filter-drawer-title">
      <div className={styles.inner}>
        <header className={styles.header}>
          <h2 id="filter-drawer-title" className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close filters">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className={styles.body}>{open && children}</div>
        <footer className={styles.footer}>{footer}</footer>
      </div>
    </dialog>
  );
}
