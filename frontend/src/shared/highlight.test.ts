import { describe, expect, it } from 'vitest';
import { splitHighlight } from './highlight';

describe('splitHighlight', () => {
  it('marks every case-insensitive occurrence', () => {
    expect(splitHighlight('Lied ohne Worte, lied', 'LIED')).toEqual([
      { text: 'Lied', match: true },
      { text: ' ohne Worte, ', match: false },
      { text: 'lied', match: true },
    ]);
  });

  it('returns the whole text unmarked for an empty term or no match', () => {
    expect(splitHighlight('Erlkönig', '  ')).toEqual([{ text: 'Erlkönig', match: false }]);
    expect(splitHighlight('Erlkönig', 'sonata')).toEqual([{ text: 'Erlkönig', match: false }]);
  });

  it('treats special characters literally', () => {
    expect(splitHighlight('Op. 9 (No. 2)', '(no.')).toEqual([
      { text: 'Op. 9 ', match: false },
      { text: '(No.', match: true },
      { text: ' 2)', match: false },
    ]);
  });
});
