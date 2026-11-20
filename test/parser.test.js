// Offline tests for the IMSLP parser. No network, no database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorksPage, parseWork, parsePageId, parseTimestamp } from '../src/parser.js';

// ---------- helpers ----------

function rawWork(overrides = {}, intvalsOverrides = {}) {
  return {
    id: 'Symphony No.5, Op.67 (Beethoven, Ludwig van)',
    type: '2',
    parent: 'Category:Beethoven, Ludwig van',
    intvals: {
      composer: 'Beethoven, Ludwig van',
      worktitle: 'Symphony No.5',
      icatno: 'Op.67',
      pageid: '1234',
      ...intvalsOverrides,
    },
    permlink: 'https://imslp.org/wiki/Symphony_No.5,_Op.67_(Beethoven,_Ludwig_van)',
    ...overrides,
  };
}

function page(works, metadata = {}) {
  return {
    works,
    metadata: { start: 0, limit: works.length, moreResultsAvailable: true, timestamp: 1795208110, ...metadata },
  };
}

function skipReason(raw) {
  const result = parseWork(raw);
  assert.equal(result.ok, false, 'expected the record to be skipped');
  return result.reason;
}

function parsed(raw) {
  const result = parseWork(raw);
  assert.equal(result.ok, true, `expected the record to be kept, got: ${result.reason}`);
  return result.work;
}

// ---------- valid records ----------

test('maps every field of a valid record', () => {
  assert.deepEqual(parsed(rawWork()), {
    imslpId: 'Symphony No.5, Op.67 (Beethoven, Ludwig van)',
    title: 'Symphony No.5',
    composerName: 'Beethoven, Ludwig van',
    catalogueNumber: 'Op.67',
    imslpPageId: 1234,
    parent: 'Category:Beethoven, Ludwig van',
    permlink: 'https://imslp.org/wiki/Symphony_No.5,_Op.67_(Beethoven,_Ludwig_van)',
  });
});

test('trims every string field but keeps inner whitespace', () => {
  const work = parsed(rawWork(
    { id: '  Some  Id \n', parent: '\tCategory:X ', permlink: ' https://imslp.org/wiki/X ' },
    { composer: '  Bach, Johann Sebastian ', worktitle: '  Mass in  B minor  ', icatno: ' BWV 232 ' },
  ));
  assert.equal(work.imslpId, 'Some  Id');
  assert.equal(work.parent, 'Category:X');
  assert.equal(work.permlink, 'https://imslp.org/wiki/X');
  assert.equal(work.composerName, 'Bach, Johann Sebastian');
  assert.equal(work.title, 'Mass in  B minor');
  assert.equal(work.catalogueNumber, 'BWV 232');
});

test('does not include the type field or unknown fields in the output', () => {
  const work = parsed(rawWork({ extra: 'x' }));
  assert.deepEqual(Object.keys(work).sort(),
    ['catalogueNumber', 'composerName', 'imslpId', 'imslpPageId', 'parent', 'permlink', 'title']);
});

// ---------- optional fields ----------

test('empty, blank or missing catalogue number becomes null', () => {
  assert.equal(parsed(rawWork({}, { icatno: '' })).catalogueNumber, null);
  assert.equal(parsed(rawWork({}, { icatno: '   ' })).catalogueNumber, null);
  assert.equal(parsed(rawWork({}, { icatno: undefined })).catalogueNumber, null);
});

test('missing or blank parent becomes null', () => {
  assert.equal(parsed(rawWork({ parent: undefined })).parent, null);
  assert.equal(parsed(rawWork({ parent: '  ' })).parent, null);
});

test('valid page ids become integers', () => {
  assert.equal(parsed(rawWork({}, { pageid: '1234' })).imslpPageId, 1234);
  assert.equal(parsed(rawWork({}, { pageid: '  42 ' })).imslpPageId, 42);
  assert.equal(parsePageId('007'), 7);
  assert.equal(parsePageId(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
});

test('missing or invalid page ids become null and the record is kept', () => {
  for (const pageid of ['12abc', '1.5', '-3', '1e3', '0', '', '   ', '0x1A', undefined, null, 1234, {}]) {
    assert.equal(parsed(rawWork({}, { pageid })).imslpPageId, null, `pageid ${JSON.stringify(pageid)}`);
  }
});

test('page ids above Number.MAX_SAFE_INTEGER become null', () => {
  assert.equal(parsePageId('9007199254740993'), null);
  assert.equal(parsePageId('99999999999999999999'), null);
});

test('missing, blank or unusual composer becomes null and the record is kept', () => {
  for (const composer of [undefined, null, '', '   ', 42, ['Bach'], { name: 'Bach' }]) {
    const work = parsed(rawWork({}, { composer }));
    assert.equal(work.composerName, null, `composer ${JSON.stringify(composer)}`);
    assert.equal(work.title, 'Symphony No.5');
  }
});

// ---------- Unicode ----------

test('preserves accents and non-Latin text exactly', () => {
  const samples = [
    ['Dvořák, Antonín', 'Slovanské tance, Op.46'],
    ['Чайковский, Пётр Ильич', 'Лебединое озеро'],
    ['武満徹', 'ノヴェンバー・ステップス'],
    ['Saint-Saëns, Camille', 'Le carnaval des animaux 🐘'],
    ['Fauré, Gabriel', 'Réquiem'], // combining accent: must not be normalized
  ];
  for (const [composer, worktitle] of samples) {
    const work = parsed(rawWork({}, { composer, worktitle }));
    assert.equal(work.composerName, composer);
    assert.equal(work.title, worktitle);
    assert.equal(work.title.length, worktitle.length);
  }
});

// ---------- skipped records ----------

test('records that are not objects are skipped', () => {
  for (const raw of [null, undefined, 'text', 42, ['a'], true]) {
    assert.equal(skipReason(raw), 'record is not an object');
  }
});

test('missing required fields are reported as "missing"', () => {
  assert.equal(skipReason(rawWork({ permlink: undefined })), 'missing permlink');
  assert.equal(skipReason(rawWork({ permlink: '   ' })), 'missing permlink');
  assert.equal(skipReason(rawWork({ id: undefined })), 'missing id');
  assert.equal(skipReason(rawWork({ id: '' })), 'missing id');
  assert.equal(skipReason(rawWork({ intvals: undefined })), 'missing intvals');
  assert.equal(skipReason(rawWork({}, { worktitle: undefined })), 'missing title');
  assert.equal(skipReason(rawWork({}, { worktitle: ' ' })), 'missing title');
});

test('required fields of the wrong type are reported as "invalid"', () => {
  assert.equal(skipReason(rawWork({ permlink: 123 })), 'invalid permlink: not a string');
  assert.equal(skipReason(rawWork({ id: 99 })), 'invalid id: not a string');
  assert.equal(skipReason(rawWork({ intvals: 'x' })), 'invalid intvals: not an object');
  assert.equal(skipReason(rawWork({ intvals: [] })), 'invalid intvals: not an object');
  assert.equal(skipReason(rawWork({}, { worktitle: ['x'] })), 'invalid title: not a string');
});

test('permlink must be an http(s) URL on imslp.org or a subdomain', () => {
  const bad = [
    'not a url',
    '/wiki/Relative_Link',
    'ftp://imslp.org/wiki/X',
    'javascript:alert(1)',
    'https://example.com/wiki/X',
    'https://notimslp.org/wiki/X',
    'https://imslp.org.evil.com/wiki/X',
  ];
  for (const permlink of bad) {
    assert.equal(skipReason(rawWork({ permlink })),
      'invalid permlink: not an http(s) imslp.org URL', permlink);
  }
  for (const permlink of ['http://imslp.org/wiki/X', 'https://IMSLP.ORG/wiki/X', 'https://www.imslp.org/wiki/X']) {
    assert.equal(parsed(rawWork({ permlink })).permlink, permlink);
  }
});

test('type other than "2" is skipped; missing type is accepted', () => {
  assert.equal(skipReason(rawWork({ type: '1' })), 'unexpected type: "1"');
  assert.equal(skipReason(rawWork({ type: '' })), 'unexpected type: ""');
  assert.equal(skipReason(rawWork({ type: 2 })), 'unexpected type: 2');
  assert.equal(parsed(rawWork({ type: undefined })).title, 'Symphony No.5');
  assert.equal(parsed(rawWork({ type: null })).title, 'Symphony No.5');
  assert.equal(parsed(rawWork({ type: ' 2 ' })).title, 'Symphony No.5');
});

// ---------- whole pages ----------

test('bad records are skipped individually and good ones keep their order', () => {
  const result = parseWorksPage(page([
    rawWork({ id: 'A', permlink: 'https://imslp.org/wiki/A' }),
    null,
    rawWork({ id: 'B', permlink: 'https://imslp.org/wiki/B' }, { worktitle: '' }),
    rawWork({ id: 'C', permlink: 'https://imslp.org/wiki/C' }),
    rawWork({ id: 'D', permlink: 'https://example.com/D' }),
    rawWork({ id: 'E', permlink: 'https://imslp.org/wiki/E' }),
  ]));

  assert.deepEqual(result.works.map((w) => w.imslpId), ['A', 'C', 'E']);
  assert.deepEqual(result.skipped, [
    { index: 1, imslpId: null, reason: 'record is not an object' },
    { index: 2, imslpId: 'B', reason: 'missing title' },
    { index: 4, imslpId: 'D', reason: 'invalid permlink: not an http(s) imslp.org URL' },
  ]);
});

test('a duplicate permlink within a page is skipped', () => {
  const result = parseWorksPage(page([
    rawWork({ id: 'first' }),
    rawWork({ id: 'second' }),
  ]));
  assert.deepEqual(result.works.map((w) => w.imslpId), ['first']);
  assert.deepEqual(result.skipped, [{ index: 1, imslpId: 'second', reason: 'duplicate permlink in page' }]);
});

test('an empty page returns empty lists', () => {
  const result = parseWorksPage(page([]));
  assert.deepEqual(result.works, []);
  assert.deepEqual(result.skipped, []);
});

test('throws TypeError only when the page itself has the wrong shape', () => {
  for (const bad of [null, undefined, 'x', [], {}, { works: 'x' }]) {
    assert.throws(() => parseWorksPage(bad), TypeError);
  }
});

// ---------- metadata ----------

test('metadata is passed through and the timestamp becomes a UTC Date', () => {
  const { meta } = parseWorksPage(page([], { start: 1000, limit: 500, moreResultsAvailable: false }));
  assert.equal(meta.start, 1000);
  assert.equal(meta.limit, 500);
  assert.equal(meta.moreResultsAvailable, false);
  assert.ok(meta.fetchedAt instanceof Date);
  assert.equal(meta.fetchedAt.toISOString(), '2026-11-20T20:55:10.000Z');
});

test('timestamp conversion handles strings and invalid values', () => {
  assert.equal(parseTimestamp(0).toISOString(), '1970-01-01T00:00:00.000Z');
  assert.equal(parseTimestamp(1700000000).toISOString(), '2023-11-14T22:13:20.000Z');
  assert.equal(parseTimestamp('1795208110').toISOString(), '2026-11-20T20:55:10.000Z');
  for (const bad of [undefined, null, '', 'abc', '-5', -5, NaN, Infinity, {}, 1e20]) {
    assert.equal(parseTimestamp(bad), null, `timestamp ${String(bad)}`);
  }
});

test('missing metadata gives undefined fields and a null date, not an error', () => {
  const { meta } = parseWorksPage({ works: [] });
  assert.deepEqual(meta, { start: undefined, limit: undefined, moreResultsAvailable: undefined, fetchedAt: null });
});
