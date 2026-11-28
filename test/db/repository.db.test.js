// Integration tests for the repository against the real PostgreSQL container.
//
// Run with: mise exec -- npm run test:db   (requires `docker compose up -d`)
//
// Isolation: see test/db/testSchema.js. Every run uses its own temporary
// schema; the application's real tables are never touched, and their row
// counts are compared before and after.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import pg from 'pg';
import { createTestSchema } from './testSchema.js';
import {
  savePage,
  startImportRun,
  resumeImportRun,
  finishImportRun,
  findResumableRun,
  acquireImporterLock,
  ImportRunStateError,
  OffsetMismatchError,
} from '../../src/adapters/postgres/repository.js';
import { toNeutralWork } from '../../src/adapters/imslp/imslpSource.js';

let db; // test schema handle
let pool;

before(async () => {
  db = await createTestSchema();
  pool = db.pool;
});

after(async () => {
  await db?.drop();
});

beforeEach(async () => {
  await db.truncateAll();
});

// ---------- helpers ----------

// Parser-shaped work converted to the neutral model, as the IMSLP source does.
function work(n, overrides = {}) {
  return toNeutralWork({
    permlink: `https://imslp.org/wiki/Test_Work_${n}`,
    imslpId: `Test Work ${n} (Bach, Johann Sebastian)`,
    title: `Test Work ${n}`,
    composerName: 'Bach, Johann Sebastian',
    catalogueNumber: `BWV ${n}`,
    imslpPageId: 1000 + n,
    parent: 'Category:Bach, Johann Sebastian',
    ...overrides,
  });
}

async function worksByPermlink() {
  const { rows } = await pool.query(
    `SELECT w.*, c.name AS composer_name
     FROM works w LEFT JOIN composers c ON c.id = w.composer_id
     ORDER BY w.permlink`,
  );
  return new Map(rows.map((row) => [row.permlink, row]));
}

async function count(table) {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${pg.escapeIdentifier(table)}`);
  return rows[0].n;
}

async function getRun(id) {
  const { rows } = await pool.query('SELECT * FROM import_runs WHERE id = $1', [id]);
  return rows[0];
}

// ---------- isolation ----------

test('every pooled connection uses only the test schema', async () => {
  const clients = await Promise.all([1, 2, 3, 4].map(() => pool.connect()));
  try {
    for (const client of clients) {
      const { rows } = await client.query(
        `SELECT current_schema() AS current,
                array_to_string(current_schemas(false), ',') AS path,
                (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.oid = 'works'::regclass) AS works_schema`,
      );
      assert.deepEqual(rows[0], { current: db.schema, path: db.schema, works_schema: db.schema });
    }
  } finally {
    clients.forEach((client) => client.release());
  }
});

// ---------- inserts ----------

test('inserts new works and composers with every column', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  const result = await savePage(pool, {
    runId: run.id,
    pageStart: 0,
    works: [work(1), work(2, { catalogueNumber: null, imslpPageId: null, parent: null })],
    fetchedCount: 2,
  });
  assert.deepEqual(result, {
    inserted: 2, updated: 0, unchanged: 0, composersInserted: 1, nextOffset: 2, finished: false,
  });

  const rows = await worksByPermlink();
  const first = rows.get(work(1).sourceWorkId);
  assert.equal(first.imslp_id, work(1).extra.imslpId);
  assert.equal(first.title, 'Test Work 1');
  assert.equal(first.composer_name, 'Bach, Johann Sebastian');
  assert.equal(first.catalogue_number, 'BWV 1');
  assert.equal(first.imslp_page_id, '1001'); // BIGINT is returned as a string
  assert.equal(first.parent, 'Category:Bach, Johann Sebastian');
  assert.equal(Number(first.last_import_run_id), run.id);

  const second = rows.get(work(2).sourceWorkId);
  assert.equal(second.catalogue_number, null);
  assert.equal(second.imslp_page_id, null);
  assert.equal(second.parent, null);
  assert.equal(await count('composers'), 1);
});

test('a work without composer gets composer_id NULL and creates no composer', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  const result = await savePage(pool, {
    runId: run.id, pageStart: 0, works: [work(1, { composerName: null })], fetchedCount: 1,
  });
  assert.equal(result.inserted, 1);
  assert.equal(result.composersInserted, 0);
  const row = (await worksByPermlink()).get(work(1).sourceWorkId);
  assert.equal(row.composer_id, null);
  assert.equal(await count('composers'), 0);
});

test('stores Unicode composer names and titles unchanged', async () => {
  const names = ['Dvořák, Antonín', 'Чайковський, Петро', '武満徹', 'Saint-Saëns, Camille'];
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  await savePage(pool, {
    runId: run.id,
    pageStart: 0,
    works: names.map((name, i) => work(i, { composerName: name, title: `Œuvre ${name}` })),
    fetchedCount: names.length,
  });
  const { rows } = await pool.query('SELECT name FROM composers ORDER BY id');
  assert.deepEqual(rows.map((row) => row.name), names);
  const stored = await worksByPermlink();
  assert.equal(stored.get(work(1).sourceWorkId).title, 'Œuvre Чайковський, Петро');
});

// ---------- upsert counters (real PostgreSQL 17 RETURNING behaviour) ----------

test('UPSERT counters: new, same works again, then partly changed works', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  const page = [work(1), work(2), work(3)];

  const first = await savePage(pool, { runId: run.id, pageStart: 0, works: page, fetchedCount: 3 });
  assert.deepEqual([first.inserted, first.updated, first.unchanged, first.composersInserted], [3, 0, 0, 1]);

  const again = await savePage(pool, { runId: run.id, pageStart: 3, works: page, fetchedCount: 3 });
  assert.deepEqual([again.inserted, again.updated, again.unchanged, again.composersInserted], [0, 0, 3, 0]);

  const changed = [work(1), work(2, { title: 'Renamed' }), work(3), work(4)];
  const third = await savePage(pool, { runId: run.id, pageStart: 6, works: changed, fetchedCount: 4 });
  assert.deepEqual([third.inserted, third.updated, third.unchanged, third.composersInserted], [1, 1, 2, 0]);

  assert.equal(await count('works'), 4);
  const runRow = await getRun(run.id);
  assert.equal(runRow.works_fetched, 3 + 3 + 4);
  assert.equal(runRow.works_upserted, 3 + 0 + 2);
  assert.equal(runRow.next_offset, 10);
});

test('each data column change counts as an update, including setting a value to NULL', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  await savePage(pool, { runId: run.id, pageStart: 0, works: [work(1)], fetchedCount: 1 });
  const changes = [
    { imslpId: 'changed id' },
    { title: 'changed title' },
    { composerName: 'Händel, Georg Friedrich' },
    { composerName: null },
    { catalogueNumber: null },
    { imslpPageId: 99 },
    { parent: 'Category:Other' },
  ];
  let overrides = {};
  let offset = 1;
  for (const change of changes) {
    overrides = { ...overrides, ...change }; // parser-field terms, mapped like the IMSLP source does
    const current = work(1, overrides);
    const result = await savePage(pool, { runId: run.id, pageStart: offset, works: [current], fetchedCount: 1 });
    offset += 1;
    assert.equal(result.updated, 1, `expected an update for ${JSON.stringify(change)}`);
  }
  const row = (await worksByPermlink()).get(work(1).sourceWorkId);
  assert.equal(row.composer_id, null);
  assert.equal(row.parent, 'Category:Other');
});

test('an update changes updated_at and last_import_run_id but not created_at; unchanged rows are not touched', async () => {
  const run1 = await startImportRun(pool, { sourceCode: 'imslp' });
  await savePage(pool, { runId: run1.id, pageStart: 0, works: [work(1), work(2)], fetchedCount: 2, finish: true });
  const before = await worksByPermlink();

  const run2 = await startImportRun(pool, { sourceCode: 'imslp' });
  const result = await savePage(pool, {
    runId: run2.id, pageStart: 0, works: [work(1, { title: 'New title' }), work(2)], fetchedCount: 2,
  });
  assert.deepEqual([result.inserted, result.updated, result.unchanged], [0, 1, 1]);

  const after = await worksByPermlink();
  const changed = after.get(work(1).sourceWorkId);
  const oldChanged = before.get(work(1).sourceWorkId);
  assert.equal(changed.title, 'New title');
  assert.equal(changed.id, oldChanged.id);
  assert.equal(changed.created_at.getTime(), oldChanged.created_at.getTime());
  assert.ok(changed.updated_at > oldChanged.updated_at, 'updated_at must move forward');
  assert.equal(Number(changed.last_import_run_id), run2.id);

  const unchanged = after.get(work(2).sourceWorkId);
  const oldUnchanged = before.get(work(2).sourceWorkId);
  assert.equal(unchanged.updated_at.getTime(), oldUnchanged.updated_at.getTime());
  assert.equal(Number(unchanged.last_import_run_id), run1.id);
});

// ---------- duplicates across pages ----------

test('duplicates across pages produce one work and one composer row', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  await savePage(pool, { runId: run.id, pageStart: 0, works: [work(1), work(2)], fetchedCount: 2 });
  const page2 = await savePage(pool, { runId: run.id, pageStart: 2, works: [work(2), work(3)], fetchedCount: 2 });
  assert.deepEqual([page2.inserted, page2.updated, page2.unchanged, page2.composersInserted], [1, 0, 1, 0]);
  assert.equal(await count('works'), 3);
  assert.equal(await count('composers'), 1);
});

test('works in different pages share an existing composer row', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  await savePage(pool, { runId: run.id, pageStart: 0, works: [work(1)], fetchedCount: 1 });
  await savePage(pool, { runId: run.id, pageStart: 1, works: [work(2)], fetchedCount: 1 });
  const { rows } = await pool.query('SELECT DISTINCT composer_id FROM works');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].composer_id, null);
});

// ---------- offset check ----------

test('a page that does not start at the stored next_offset is rejected and writes nothing', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp', startOffset: 100 });
  await savePage(pool, { runId: run.id, pageStart: 100, works: [work(1)], fetchedCount: 10 });

  for (const stale of [100, 105, 120]) {
    await assert.rejects(
      savePage(pool, { runId: run.id, pageStart: stale, works: [work(2)], fetchedCount: 10 }),
      (error) => error instanceof OffsetMismatchError && error.storedNextOffset === 110,
    );
  }
  assert.equal(await count('works'), 1);
  const runRow = await getRun(run.id);
  assert.equal(runRow.next_offset, 110);
  assert.equal(runRow.works_fetched, 10);
});

test('two concurrent saves of the same page: exactly one succeeds', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  const attempt = (n) => savePage(pool, { runId: run.id, pageStart: 0, works: [work(n)], fetchedCount: 5 });
  const results = await Promise.allSettled([attempt(1), attempt(2)]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof OffsetMismatchError);
  assert.equal(await count('works'), 1);
  const runRow = await getRun(run.id);
  assert.equal(runRow.next_offset, 5);
  assert.equal(runRow.works_fetched, 5);
});

// ---------- finish flag ----------

test('finish: true marks the run succeeded in the same transaction as the final page', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  const result = await savePage(pool, { runId: run.id, pageStart: 0, works: [work(1)], fetchedCount: 10, finish: true });
  assert.equal(result.finished, true);
  const runRow = await getRun(run.id);
  assert.equal(runRow.status, 'succeeded');
  assert.ok(runRow.finished_at instanceof Date);
  assert.equal(runRow.next_offset, 10);
  assert.equal(await findResumableRun(pool, 'imslp'), null);
  await assert.rejects(
    savePage(pool, { runId: run.id, pageStart: 10, works: [work(2)], fetchedCount: 1 }),
    ImportRunStateError,
  );
});

test('a failed final page does not mark the run succeeded', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  await assert.rejects(savePage(pool, {
    runId: run.id, pageStart: 0, works: [work(1, { title: null })], fetchedCount: 1, finish: true,
  }));
  const runRow = await getRun(run.id);
  assert.equal(runRow.status, 'running');
  assert.equal(runRow.finished_at, null);
  assert.equal(runRow.next_offset, 0);
});

// ---------- transactions, rollback and progress ----------

test('a constraint violation rolls back the whole page and does not advance next_offset', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp', startOffset: 1000 });
  const bad = work(2, { title: null, composerName: 'New Composer' }); // violates works.title NOT NULL
  await assert.rejects(
    savePage(pool, { runId: run.id, pageStart: 1000, works: [work(1), bad], fetchedCount: 2 }),
    (error) => error.code === '23502', // not_null_violation
  );
  assert.equal(await count('works'), 0);
  assert.equal(await count('composers'), 0, 'composer insert must be rolled back too');
  const runRow = await getRun(run.id);
  assert.equal(runRow.next_offset, 1000);
  assert.equal(runRow.works_fetched, 0);
  assert.equal(runRow.works_upserted, 0);
});

test('a page saved to a failed (not resumed) run is refused and writes nothing', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  await finishImportRun(pool, run.id, { status: 'failed', errorMessage: 'network' });
  await assert.rejects(
    savePage(pool, { runId: run.id, pageStart: 0, works: [work(1)], fetchedCount: 1 }),
    ImportRunStateError,
  );
  assert.equal(await count('works'), 0);
  assert.equal(await count('composers'), 0);
  assert.equal((await getRun(run.id)).next_offset, 0);
});

test('a page for an unknown run is rejected and rolled back', async () => {
  await assert.rejects(
    savePage(pool, { runId: 999, pageStart: 0, works: [work(1)], fetchedCount: 1 }),
    ImportRunStateError,
  );
  assert.equal(await count('works'), 0);
});

test('a page whose records were all skipped still advances next_offset by the raw count', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp', startOffset: 1000 });
  const result = await savePage(pool, { runId: run.id, pageStart: 1000, works: [], fetchedCount: 1000 });
  assert.equal(result.nextOffset, 2000);
  assert.equal(result.inserted + result.updated + result.unchanged, 0);
  const runRow = await getRun(run.id);
  assert.equal(runRow.next_offset, 2000);
  assert.equal(runRow.works_fetched, 1000);
  assert.equal(runRow.works_upserted, 0);
});

test('connections are released after failures (pool of size 1 does not hang)', async () => {
  const smallPool = db.makePool({ max: 1, connectionTimeoutMillis: 2_000 });
  try {
    const run = await startImportRun(smallPool, { sourceCode: 'imslp' });
    for (let i = 0; i < 3; i += 1) {
      await assert.rejects(savePage(smallPool, {
        runId: run.id, pageStart: 0, works: [work(1, { title: null })], fetchedCount: 1,
      }));
      await assert.rejects(savePage(smallPool, {
        runId: 999, pageStart: 0, works: [work(1)], fetchedCount: 1,
      }), ImportRunStateError);
      await assert.rejects(savePage(smallPool, {
        runId: run.id, pageStart: 7, works: [work(1)], fetchedCount: 1,
      }), OffsetMismatchError);
    }
    const ok = await savePage(smallPool, { runId: run.id, pageStart: 0, works: [work(1)], fetchedCount: 1 });
    assert.equal(ok.inserted, 1);
    assert.equal(smallPool.waitingCount, 0);
    assert.equal(smallPool.idleCount, smallPool.totalCount);
  } finally {
    await smallPool.end();
  }
});

// ---------- run lifecycle and resumption ----------

test('a failed run can be found, resumed and continued from its next_offset', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  await savePage(pool, { runId: run.id, pageStart: 0, works: [work(1), work(2)], fetchedCount: 3 });
  await finishImportRun(pool, run.id, { status: 'failed', errorMessage: 'IMSLP timeout' });

  const found = await findResumableRun(pool, 'imslp');
  assert.equal(found.id, run.id);
  assert.equal(found.status, 'failed');
  assert.equal(found.nextOffset, 3);
  assert.equal(found.errorMessage, 'IMSLP timeout');

  // Not resumed yet: saving must be refused.
  await assert.rejects(
    savePage(pool, { runId: run.id, pageStart: 3, works: [work(3)], fetchedCount: 1 }),
    ImportRunStateError,
  );

  const resumed = await resumeImportRun(pool, run.id);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.nextOffset, 3);
  assert.equal(resumed.finishedAt, null);
  assert.equal(resumed.errorMessage, null);
  assert.equal(resumed.worksFetched, 3, 'progress counters are kept');

  await savePage(pool, { runId: run.id, pageStart: 3, works: [work(3)], fetchedCount: 1, finish: true });
  const done = await getRun(run.id);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.next_offset, 4);
  assert.equal(done.works_fetched, 4);
  assert.equal(done.works_upserted, 3);

  assert.equal(await findResumableRun(pool, 'imslp'), null);
  await assert.rejects(resumeImportRun(pool, run.id), ImportRunStateError);
});

test('an interrupted run left in status running can be found and resumed', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp', startOffset: 5000 });
  await savePage(pool, { runId: run.id, pageStart: 5000, works: [work(1)], fetchedCount: 1000 });
  // simulate a crash: no finishImportRun

  const found = await findResumableRun(pool, 'imslp');
  assert.equal(found.id, run.id);
  assert.equal(found.status, 'running');
  assert.equal(found.nextOffset, 6000);
  const resumed = await resumeImportRun(pool, run.id);
  assert.equal(resumed.nextOffset, 6000);
});

test('findResumableRun ignores older failed runs when the latest run succeeded', async () => {
  const failed = await startImportRun(pool, { sourceCode: 'imslp' });
  await finishImportRun(pool, failed.id, { status: 'failed', errorMessage: 'x' });
  const ok = await startImportRun(pool, { sourceCode: 'imslp' });
  await finishImportRun(pool, ok.id, { status: 'succeeded' });
  assert.equal(await findResumableRun(pool, 'imslp'), null);
});

test('findResumableRun returns null when there are no runs', async () => {
  assert.equal(await findResumableRun(pool, 'imslp'), null);
});

test('finishImportRun refuses a run that is not running', async () => {
  const run = await startImportRun(pool, { sourceCode: 'imslp' });
  await finishImportRun(pool, run.id, { status: 'succeeded' });
  await assert.rejects(finishImportRun(pool, run.id, { status: 'failed' }), ImportRunStateError);
  await assert.rejects(finishImportRun(pool, 12345, { status: 'failed' }), ImportRunStateError);
});

// ---------- importer lock ----------

test('acquireImporterLock: only one holder at a time; released lock can be taken again', async () => {
  const key = randomInt(1, 2 ** 40); // never the real importer's key
  const first = await acquireImporterLock(pool, { key });
  assert.ok(first, 'first caller gets the lock');
  const second = await acquireImporterLock(pool, { key });
  assert.equal(second, null, 'second caller is refused while the lock is held');
  await first.release();
  const third = await acquireImporterLock(pool, { key });
  assert.ok(third, 'lock can be taken again after release');
  await third.release();
  await third.release(); // releasing twice is harmless
  assert.equal(pool.idleCount, pool.totalCount, 'lock connections are returned to the pool');
});
