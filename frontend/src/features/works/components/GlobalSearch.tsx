// The one search box of the application, shown in the header on every page.
// Presentational: the behaviour lives in useGlobalSearch.
import type { FormEvent } from 'react';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { SEARCH_SCOPES, type SearchScope } from '../model/searchScope';
import styles from './GlobalSearch.module.css';

export function GlobalSearch() {
  const { scope, text, setText, setScope, submit } = useGlobalSearch();
  const placeholder = SEARCH_SCOPES.find((option) => option.value === scope)?.placeholder;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  return (
    <form role="search" aria-label="Search the catalogue" className={styles.search} onSubmit={onSubmit}>
      <label htmlFor="global-search-scope" className="visually-hidden">
        Search in
      </label>
      <select
        id="global-search-scope"
        className={styles.scope}
        value={scope}
        onChange={(event) => setScope(event.target.value as SearchScope)}
      >
        {SEARCH_SCOPES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label htmlFor="global-search-input" className="visually-hidden">
        {scope === 'title' ? 'Search by title' : 'Search by composer'}
      </label>
      <input
        id="global-search-input"
        type="search"
        className={styles.input}
        placeholder={placeholder}
        value={text}
        maxLength={200}
        autoComplete="off"
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className={styles.button}>
        <span aria-hidden="true" className={styles.icon}>
          ⌕
        </span>
        <span className={styles.buttonLabel}>Search</span>
      </button>
    </form>
  );
}
