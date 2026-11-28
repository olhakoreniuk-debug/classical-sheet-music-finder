import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from './catalogueQuery';
import { applySearch, scopeFromFilters, searchTextFor, switchScope } from './searchScope';

describe('search scope', () => {
  it('derives the scope from the filled field and otherwise keeps the current one', () => {
    expect(scopeFromFilters({ ...DEFAULT_FILTERS, composer: 'Schubert' }, 'title')).toBe('composer');
    expect(scopeFromFilters({ ...DEFAULT_FILTERS, q: 'Lied' }, 'composer')).toBe('title');
    expect(scopeFromFilters(DEFAULT_FILTERS, 'composer')).toBe('composer');
    expect(scopeFromFilters({ ...DEFAULT_FILTERS, q: 'Lied', composer: 'Schubert' }, 'composer')).toBe('composer');
  });

  it('applies a search to one field and keeps the other filters', () => {
    const start = { ...DEFAULT_FILTERS, source: 'imslp', composer: 'Schubert', page: 3 };
    const next = applySearch(start, 'title', '  Lied ');
    expect(next).toEqual({ ...start, q: 'Lied', page: 1 });
    expect(searchTextFor(next, 'composer')).toBe('Schubert');
  });

  it('moves the text to the other field when the scope changes', () => {
    const start = { ...DEFAULT_FILTERS, q: 'Schubert' };
    expect(switchScope(start, 'title', 'composer', 'Schubert')).toEqual({ ...DEFAULT_FILTERS, composer: 'Schubert' });
  });
});
