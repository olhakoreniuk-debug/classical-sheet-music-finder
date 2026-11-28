// Integration tests: catalogue use cases + PostgreSQL adapters in a temporary schema.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createWork } from '../../src/core/catalog/createWork.js';
import { getWork } from '../../src/core/catalog/getWork.js';
import { listSources } from '../../src/core/catalog/listSources.js';
import { listWorks } from '../../src/core/catalog/listWorks.js';
import { DuplicatePageUrlError, WorkNotFoundError } from '../../src/core/errors.js';
import {
  createPostgresSourceQueries,
  createPostgresWorkCommands,
  createPostgresWorkQueries,
} from '../../src/adapters/postgres/catalogRepository.js';
import { createPostgresRepository } from '../../src/adapters/postgres/repository.js';
import { createTestSchema } from './testSchema.js';

let db;
let deps;
let importRepo;

before(async () => {
  db = await createTestSchema();
  deps = {
    workQueries: createPostgresWorkQueries(db.pool),
    workCommands: createPostgresWorkCommands(db.pool),
    sourceQueries: createPostgresSourceQueries(db.pool),
  };
  importRepo = createPostgresRepository(db.pool);
});

after(async () => {
  await db?.drop();
});

beforeEach(async () => {
  await db.truncateAll();
});

const permlink = 'https://imslp.org/wiki/"A"_(Ferrari,_Carlotta)';

async function importImslpWork() {
  const run = await importRepo.startImportRun({ sourceCode: 'imslp' });
  await importRepo.savePage({
    runId: run.id, pageStart: 0, fetchedCount: 1, finish: true,
    works: [{
      sourceWorkId: permlink, title: '"A"', composerName: 'Ferrari, Carlotta', catalogueNumber: 'ICF 1237',
      pageUrl: permlink, extra: { imslpId: '"A" (Ferrari, Carlotta)', imslpPageId: null, parent: null },
    }],
  });
}

test('listSources returns the seeded sources as in the contract example', async () => {
  assert.deepEqual(await listSources(deps), [
    { code: 'manual', name: 'Added manually', kind: 'manual', homepageUrl: null, attribution: null, metadataLicence: null },
    {
      code: 'imslp', name: 'IMSLP', kind: 'external', homepageUrl: 'https://imslp.org',
      attribution: 'Data from IMSLP, the Petrucci Music Library (imslp.org).', metadataLicence: null,
    },
  ]);
});

test('createWork adds a manual work with a UUID record id, reusing an existing composer', async () => {
  await importImslpWork();
  const work = await createWork(deps, { title: ' Erlkönig ', composerName: 'Ferrari, Carlotta', catalogueNumber: null, pageUrl: null });
  assert.equal(work.title, 'Erlkönig');
  assert.deepEqual(work.source, { code: 'manual', name: 'Added manually' });
  assert.match(work.sourceRecordId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(work.attribution, null);
  const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM composers');
  assert.equal(rows[0].n, 1, 'the existing composer is reused');
  assert.deepEqual(await getWork(deps, work.id), work);
});

test('createWork rejects a page URL that an imported work already has, also in encoded form', async () => {
  await importImslpWork();
  await assert.rejects(
    createWork(deps, { title: 'Copy', pageUrl: 'https://imslp.org/wiki/%22A%22_(Ferrari,_Carlotta)' }),
    DuplicatePageUrlError,
  );
  await createWork(deps, { title: 'Own page', pageUrl: 'https://example.org/a' });
  await assert.rejects(createWork(deps, { title: 'Again', pageUrl: ' https://example.org/a ' }), DuplicatePageUrlError);
});

test('an IMSLP re-import never updates a manual work with the same page URL (ADR-0002)', async () => {
  // Manual work first; the import of the same URL creates a separate IMSLP row.
  const manual = await createWork(deps, { title: 'Mine', pageUrl: permlink });
  await importImslpWork();
  const again = await getWork(deps, manual.id);
  assert.equal(again.title, 'Mine');
  assert.equal(again.source.code, 'manual');
  const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM works');
  assert.equal(rows[0].n, 2);
});

test('listWorks filters, sorts with id tie-breaker, counts and maps attribution', async () => {
  await importImslpWork();
  await createWork(deps, { title: 'Wiegenlied', composerName: 'Brahms, Johannes', catalogueNumber: 'Op.49 No.4' });
  await createWork(deps, { title: '100% Lied_x', composerName: null });

  // Title order follows the database collation (which may ignore punctuation),
  // so check the contract's guarantees instead of one locale's order.
  const all = await listWorks(deps, {});
  const titles = all.data.map((w) => w.title);
  assert.deepEqual([...titles].sort(), ['"A"', '100% Lied_x', 'Wiegenlied'].sort());
  assert.equal(all.page.total, 3);
  const descending = (await listWorks(deps, { sort: '-title' })).data.map((w) => w.title);
  assert.deepEqual(descending, [...titles].reverse());
  const imported = all.data.find((w) => w.source.code === 'imslp');
  assert.equal(imported.attribution, 'Data from IMSLP, the Petrucci Music Library (imslp.org).');
  assert.equal(imported.sourceRecordId, permlink);
  assert.equal(imported.pageUrl, permlink);

  const literal = await listWorks(deps, { q: '% lied_' }); // wildcards are matched literally
  assert.deepEqual(literal.data.map((w) => w.title), ['100% Lied_x']);
  assert.equal((await listWorks(deps, { composer: 'BRAHMS' })).page.total, 1);
  assert.equal((await listWorks(deps, { hasCatalogueNumber: false })).data[0].title, '100% Lied_x');
  assert.equal((await listWorks(deps, { source: 'imslp' })).page.total, 1);
  assert.deepEqual(await listWorks(deps, { source: 'unknown' }), { data: [], page: { limit: 20, offset: 0, total: 0 } });

  const page2 = await listWorks(deps, { sort: '-title', limit: 1, offset: 1 });
  assert.deepEqual(page2.data.map((w) => w.title), [descending[1]]);
  assert.deepEqual(page2.page, { limit: 1, offset: 1, total: 3 });
});

test('getWork reports a missing work', async () => {
  await assert.rejects(getWork(deps, 123456), WorkNotFoundError);
});
