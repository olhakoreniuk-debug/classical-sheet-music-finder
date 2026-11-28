// Offline tests for the catalogue use cases (fake ports) and the IMSLP source mapping.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWork } from '../src/core/catalog/createWork.js';
import { getWork } from '../src/core/catalog/getWork.js';
import { listWorks } from '../src/core/catalog/listWorks.js';
import { pageUrlKey } from '../src/core/catalog/pageUrl.js';
import { WorkNotFoundError, WorkValidationError } from '../src/core/errors.js';
import { createImslpSource } from '../src/adapters/imslp/imslpSource.js';
import { ImportPageError } from '../src/core/errors.js';

test('pageUrlKey trims and percent-decodes, so encoded and raw permlinks match', () => {
  assert.equal(pageUrlKey('  https://imslp.org/wiki/%22A%22_(Ferrari,_Carlotta) '), 'https://imslp.org/wiki/"A"_(Ferrari,_Carlotta)');
  assert.equal(pageUrlKey('https://imslp.org/wiki/"A"_(Ferrari,_Carlotta)'), 'https://imslp.org/wiki/"A"_(Ferrari,_Carlotta)');
  assert.equal(pageUrlKey('https://x.org/100%'), 'https://x.org/100%'); // malformed escape kept
  assert.equal(pageUrlKey(null), null);
  assert.equal(pageUrlKey('   '), null);
});

test('createWork trims values and passes the page URL key to the port', async () => {
  let received;
  const workCommands = { createManualWork: async (work) => { received = work; return { id: 1 }; } };
  await createWork({ workCommands }, { title: '  Erlkönig ', composerName: ' Schubert, Franz ', pageUrl: ' https://example.org/%C3%A9 ' });
  assert.deepEqual(received, {
    title: 'Erlkönig', composerName: 'Schubert, Franz', catalogueNumber: null,
    pageUrl: 'https://example.org/%C3%A9', pageUrlKey: 'https://example.org/é',
  });
});

test('createWork rejects blank, too long and non-http values with field errors', async () => {
  const workCommands = { createManualWork: async () => assert.fail('must not be called') };
  await assert.rejects(
    createWork({ workCommands }, { title: '   ', composerName: ' ', catalogueNumber: 'x'.repeat(101), pageUrl: 'ftp://a' }),
    (error) => {
      assert.ok(error instanceof WorkValidationError);
      assert.deepEqual(error.errors.map((e) => [e.field, e.code]), [
        ['/title', 'blank'], ['/composerName', 'blank'], ['/catalogueNumber', 'too_long'], ['/pageUrl', 'invalid_format'],
      ]);
      assert.ok(error.errors.every((e) => e.location === 'body' && e.message));
      return true;
    },
  );
  await assert.rejects(createWork({ workCommands }, {}), (error) => error.errors[0].code === 'required');
});

test('listWorks applies contract defaults and returns page info', async () => {
  let criteria;
  const workQueries = { listWorks: async (c) => { criteria = c; return { works: [], total: 0 }; } };
  assert.deepEqual(await listWorks({ workQueries }, { q: '  lied ' }), { data: [], page: { limit: 20, offset: 0, total: 0 } });
  assert.deepEqual(criteria, {
    titleContains: 'lied', composerContains: null, hasCatalogueNumber: null, sourceCode: null, sort: 'title', limit: 20, offset: 0,
  });
  await assert.rejects(listWorks({ workQueries }, { sort: 'id' }), TypeError);
});

test('getWork throws WorkNotFoundError for a missing work', async () => {
  const workQueries = { getWork: async () => null };
  await assert.rejects(getWork({ workQueries }, 99), WorkNotFoundError);
});

test('the IMSLP source returns a neutral page and keeps IMSLP checks', async () => {
  const raw = {
    id: 'Wiegenlied, Op.49 No.4 (Brahms, Johannes)', type: '2', parent: 'Category:Brahms, Johannes',
    intvals: { composer: 'Brahms, Johannes', worktitle: 'Wiegenlied', icatno: 'Op.49 No.4', pageid: '123' },
    permlink: 'https://imslp.org/wiki/Wiegenlied,_Op.49_No.4_(Brahms,_Johannes)',
  };
  const source = createImslpSource({
    client: { fetchWorksPage: async ({ start }) => ({ works: [raw], metadata: { start, moreResultsAvailable: false } }) },
  });
  const page = await source.fetchPage({ start: 0, limit: 10 });
  assert.equal(source.code, 'imslp');
  assert.deepEqual(page, {
    works: [{
      sourceWorkId: raw.permlink, title: 'Wiegenlied', composerName: 'Brahms, Johannes', catalogueNumber: 'Op.49 No.4',
      pageUrl: raw.permlink, extra: { imslpId: raw.id, imslpPageId: 123, parent: 'Category:Brahms, Johannes' },
    }],
    skipped: [], fetchedCount: 1, moreAvailable: false,
  });

  const wrongStart = createImslpSource({ client: { fetchWorksPage: async () => ({ works: [], metadata: { start: 5 } }) } });
  await assert.rejects(wrongStart.fetchPage({ start: 0, limit: 10 }), ImportPageError);
});
