import { Fragment } from 'react';
import { splitHighlight } from '../shared/highlight';
import styles from './Highlight.module.css';

/** Renders text with the parts that match the search term marked. */
export function Highlight({ text, term }: { text: string; term: string | undefined }) {
  const parts = splitHighlight(text, term ?? '');
  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          // Plain text nodes keep their spaces in the accessible name.
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
