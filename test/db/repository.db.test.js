// Integration tests for the repository against the real PostgreSQL container.
//
// Run with: mise exec -- npm run test:db   (requires `docker compose up -d`)
//
// Isolation: every run creates its own schema test_<16 hex chars>, loads
// db/schema.sql into it and drops it at the end. All test connections use
// search_path = that schema only, so unqualified table names can never reach
// the application's real tables in "public". The row counts of the real
// tables are compared before and after as an extra safety check.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createPool, readDbConfig } from '../../src/db.js';
import {
  savePage,
  startImportRun,
  resumeImportRun,
  finishImportRun,
  findResumableRun,
  ImportRunStateError,
} from '../../src/repository.js';

const SCHEMA_PATTERN = /^test_[0-9a-f]{16}$/;
const schema = `test_${randomBytes(8).toString('hex')}`;
const quotedSchema = pg.escapeIdentifier(schema);
const REAL_TABLES = ['works', 'composers', 'import_runs'];

let adminPool; // default search_path; only creates/drops the test schema and reads public counts
let pool; // all repository calls; search_path = test schema only
let realCountsBefore;

function assertTestSchemaName(name) {
  assert.match(name, SCHEMA_PATTERN, 'refusing to use a schema that is not a generated test schema');
}

function testPool(options = {}) {
  assertTestSchemaName(schema);
  return createPool(readDbConfig(), { options: `-c search_path=${quotedSchema}`, ...options });
}

async function countRealTables() {
  const counts = {};
  for (const table of REAL_TABLES) {
    const qualified = `public.${pg.escapeIdentifier(table)}`;
    const { rows } = await adminPool.query('SELECT to_regclass($1) AS oid', [qualified]);
    if (rows[0].oid === null) {
      counts[table] = null; // table does not exist in public
    } else {
      const result = await adminPool.query(`SELECT count(*)::int AS n FROM ${qualified}`);
      counts[table] = result.rows[0].n;
    }
  }
  return counts;
}

before(async () => {
  assertTestSchemaName(schema);
  adminPool = createPool(readDbConfig(), { max: 1 });
  realCountsBefore = await countRealTables();
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  pool = testPool();
  const schemaSql = await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8');
  await pool.query(schemaSql);
});

after(async () => {
  await pool?.end();
  if (adminPool) {
    assertTestSchemaName(schema);
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    const realCountsAfter = await countRealTables();
    await adminPool.end();
    assert.deepEqual(realCountsAfter, realCountsBefore, 'real tables in public must not change');
  }
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE ${quotedSchema}.works, ${quotedSchema}.composers, ${quotedSchema}.import_runs
     RESTART IDENTITY CASCADE`,
  );
});

// ---------- helpers ----------

function work(n, overrides = {}) {
  return {
    permlink: `https://imslp.org/wiki/Test_Work_${n}`,
    imslpId: `Test Work ${n} (Bach, Johann Sebastian)`,
    title: `Test Work ${n}`,
    composerName: 'Bach, Johann Sebastian',
    catalogueNumber: `BWV ${n}`,
    imslpPageId: 1000 + n,
    parent: 'Category:Bach, Johann Sebastian',
    ...overrides,
  };
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
      assert.deepEqual(rows[0], { current: schema, path: schema, works_schema: schema });
    }
  } finally {
    clients.forEach((client) => client.release());
  }
});

// ---------- inserts ----------

test('inserts new works and composers with every column', async () => {
  const run = await startImportRun(pool);
  const result = await savePage(pool, {
    runId: run.id,
    works: [work(1), work(2, { catalogueNumber: null, imslpPageId: null, parent: null })],
    fetchedCount: 2,
    nextOffset: 2,
  });
  assert.deepEqual(result, { inserted: 2, updated: 0, unchanged: 0, composersInserted: 1 });

  const rows = await worksByPermlink();
  const first = rows.get(work(1).permlink);
  assert.equal(first.imslp_id, work(1).imslpId);
  assert.equal(first.title, 'Test Work 1');
  assert.equal(first.composer_name, 'Bach, Johann Sebastian');
  assert.equal(first.catalogue_number, 'BWV 1');
  assert.equal(first.imslp_page_id, '1001'); // BIGINT is returned as a string
  assert.equal(first.parent, 'Category:Bach, Johann Sebastian');
  assert.equal(Number(first.last_import_run_id), run.id);

  const second = rows.get(work(2).permlink);
  assert.equal(second.catalogue_number, null);
  assert.equal(second.imslp_page_id, null);
  assert.equal(second.parent, null);
  assert.equal(await count('composers'), 1);
});

test('a work without composer gets composer_id NULL and creates no composer', async () => {
  const run = await startImportRun(pool);
  const result = await savePage(pool, {
    runId: run.id, works: [work(1, { composerName: null })], fetchedCount: 1, nextOffset: 1,
  });
  assert.deepEqual(result, { inserted: 1, updated: 0, unchanged: 0, composersInserted: 0 });
  const row = (await worksByPermlink()).get(work(1).permlink);
  assert.equal(row.composer_id, null);
  assert.equal(await count('composers'), 0);
});

test('stores Unicode composer names and titles unchanged', async () => {
  const names = ['Dvořák, Antonín', 'Чайковський, Петро', '武満徹', 'Saint-Saëns, Camille'];
  const run = await startImportRun(pool);
  await savePage(pool, {
    runId: run.id,
    works: names.map((name, i) => work(i, { composerName: name, title: `Œuvre ${name}` })),
    fetchedCount: names.length,
    nextOffset: names.length,
  });
  const { rows } = await pool.query('SELECT name FROM composers ORDER BY id');
  assert.deepEqual(rows.map((row) => row.name), names);
  const stored = await worksByPermlink();
  assert.equal(stored.get(work(1).permlink).title, 'Œuvre Чайковський, Петро');
});

// ---------- upsert counters (real PostgreSQL 17 RETURNING behaviour) ----------

test('UPSERT counters: new, same page again, then partly changed page', async () => {
  const run = await startImportRun(pool);
  const page = [work(1), work(2), work(3)];

  const first = await savePage(pool, { runId: run.id, works: page, fetchedCount: 3, nextOffset: 3 });
  assert.deepEqual(first, { inserted: 3, updated: 0, unchanged: 0, composersInserted: 1 });

  const again = await savePage(pool, { runId: run.id, works: page, fetchedCount: 3, nextOffset: 3 });
  assert.deepEqual(again, { inserted: 0, updated: 0, unchanged: 3, composersInserted: 0 });

  const changed = [work(1), work(2, { title: 'Renamed' }), work(3), work(4)];
  const third = await savePage(pool, { runId: run.id, works: changed, fetchedCount: 4, nextOffset: 7 });
  assert.deepEqual(third, { inserted: 1, updated: 1, unchanged: 2, composersInserted: 0 });

  assert.equal(await count('works'), 4);
  const runRow = await getRun(run.id);
  assert.equal(runRow.works_fetched, 3 + 3 + 4);
  assert.equal(runRow.works_upserted, 3 + 0 + 2);
  assert.equal(runRow.next_offset, 7);
});

test('each data column change counts as an update, including setting a value to NULL', async () => {
  const run = await startImportRun(pool);
  await savePage(pool, { runId: run.id, works: [work(1)], fetchedCount: 1, nextOffset: 1 });
  const changes = [
    { imslpId: 'changed id' },
    { title: 'changed title' },
    { composerName: 'Händel, Georg Friedrich' },
    { composerName: null },
    { catalogueNumber: null },
    { imslpPageId: 99 },
    { parent: 'Category:Other' },
  ];
  let current = work(1);
  for (const change of changes) {
    current = { ...current, ...change };
    const result = await savePage(pool, { runId: run.id, works: [current], fetchedCount: 1, nextOffset: 1 });
    assert.deepEqual(result.updated, 1, `expected an update for ${JSON.stringify(change)}`);
  }
  const row = (await worksByPermlink()).get(work(1).permlink);
  assert.equal(row.composer_id, null);
  assert.equal(row.parent, 'Category:Other');
});

test('an update changes updated_at and last_import_run_id but not created_at; unchanged rows are not touched', async () => {
  const run1 = await startImportRun(pool);
  await savePage(pool, { runId: run1.id, works: [work(1), work(2)], fetchedCount: 2, nextOffset: 2 });
  await finishImportRun(pool, run1.id, { status: 'succeeded' });
  const before = await worksByPermlink();

  const run2 = await startImportRun(pool);
  const result = await savePage(pool, {
    runId: run2.id, works: [work(1, { title: 'New title' }), work(2)], fetchedCount: 2, nextOffset: 2,
  });
  assert.deepEqual(result, { inserted: 0, updated: 1, unchanged: 1, composersInserted: 0 });

  const after = await worksByPermlink();
  const changed = after.get(work(1).permlink);
  const oldChanged = before.get(work(1).permlink);
  assert.equal(changed.title, 'New title');
  assert.equal(changed.id, oldChanged.id);
  assert.equal(changed.created_at.getTime(), oldChanged.created_at.getTime());
  assert.ok(changed.updated_at > oldChanged.updated_at, 'updated_at must move forward');
  assert.equal(Number(changed.last_import_run_id), run2.id);

  const unchanged = after.get(work(2).permlink);
  const oldUnchanged = before.get(work(2).permlink);
  assert.equal(unchanged.updated_at.getTime(), oldUnchanged.updated_at.getTime());
  assert.equal(Number(unchanged.last_import_run_id), run1.id);
});

// ---------- duplicates across pages ----------

test('duplicates across pages produce one work and one composer row', async () => {
  const run = await startImportRun(pool);
  await savePage(pool, { runId: run.id, works: [work(1), work(2)], fetchedCount: 2, nextOffset: 2 });
  const page2 = await savePage(pool, {
    runId: run.id, works: [work(2), work(3)], fetchedCount: 2, nextOffset: 4,
  });
  assert.deepEqual(page2, { inserted: 1, updated: 0, unchanged: 1, composersInserted: 0 });
  assert.equal(await count('works'), 3);
  assert.equal(await count('composers'), 1);
});

test('works in different pages share an existing composer row', async () => {
  const run = await startImportRun(pool);
  await savePage(pool, { runId: run.id, works: [work(1)], fetchedCount: 1, nextOffset: 1 });
  await savePage(pool, { runId: run.id, works: [work(2)], fetchedCount: 1, nextOffset: 2 });
  const { rows } = await pool.query('SELECT DISTINCT composer_id FROM works');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].composer_id, null);
});

// ---------- transactions, rollback and progress ----------

test('a constraint violation rolls back the whole page and does not advance next_offset', async () => {
  const run = await startImportRun(pool, { startOffset: 1000 });
  const bad = work(2, { title: null, composerName: 'New Composer' }); // violates works.title NOT NULL
  await assert.rejects(
    savePage(pool, { runId: run.id, works: [work(1), bad], fetchedCount: 2, nextOffset: 1002 }),
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
  const run = await startImportRun(pool);
  await finishImportRun(pool, run.id, { status: 'failed', errorMessage: 'network' });
  await assert.rejects(
    savePage(pool, { runId: run.id, works: [work(1)], fetchedCount: 1, nextOffset: 1 }),
    ImportRunStateError,
  );
  assert.equal(await count('works'), 0);
  assert.equal(await count('composers'), 0);
  assert.equal((await getRun(run.id)).next_offset, 0);
});

test('a page for an unknown run is rejected and rolled back', async () => {
  await assert.rejects(
    savePage(pool, { runId: 999, works: [work(1)], fetchedCount: 1, nextOffset: 1 }),
    ImportRunStateError,
  );
  assert.equal(await count('works'), 0);
});

test('a page whose records were all skipped still advances next_offset by the raw count', async () => {
  const run = await startImportRun(pool, { startOffset: 1000 });
  const result = await savePage(pool, { runId: run.id, works: [], fetchedCount: 1000, nextOffset: 2000 });
  assert.deepEqual(result, { inserted: 0, updated: 0, unchanged: 0, composersInserted: 0 });
  const runRow = await getRun(run.id);
  assert.equal(runRow.next_offset, 2000);
  assert.equal(runRow.works_fetched, 1000);
  assert.equal(runRow.works_upserted, 0);
});

test('connections are released after failures (pool of size 1 does not hang)', async () => {
  const smallPool = testPool({ max: 1, connectionTimeoutMillis: 2_000 });
  try {
    const run = await startImportRun(smallPool);
    for (let i = 0; i < 3; i += 1) {
      await assert.rejects(savePage(smallPool, {
        runId: run.id, works: [work(1, { title: null })], fetchedCount: 1, nextOffset: 1,
      }));
      await assert.rejects(savePage(smallPool, {
        runId: 999, works: [work(1)], fetchedCount: 1, nextOffset: 1,
      }), ImportRunStateError);
    }
    const ok = await savePage(smallPool, { runId: run.id, works: [work(1)], fetchedCount: 1, nextOffset: 1 });
    assert.equal(ok.inserted, 1);
    assert.equal(smallPool.waitingCount, 0);
    assert.equal(smallPool.idleCount, smallPool.totalCount);
  } finally {
    await smallPool.end();
  }
});

// ---------- run lifecycle and resumption ----------

test('a failed run can be found, resumed and continued from its next_offset', async () => {
  const run = await startImportRun(pool);
  await savePage(pool, { runId: run.id, works: [work(1), work(2)], fetchedCount: 3, nextOffset: 3 });
  await finishImportRun(pool, run.id, { status: 'failed', errorMessage: 'IMSLP timeout' });

  const found = await findResumableRun(pool);
  assert.equal(found.id, run.id);
  assert.equal(found.status, 'failed');
  assert.equal(found.nextOffset, 3);
  assert.equal(found.errorMessage, 'IMSLP timeout');

  // Not resumed yet: saving must be refused.
  await assert.rejects(
    savePage(pool, { runId: run.id, works: [work(3)], fetchedCount: 1, nextOffset: 4 }),
    ImportRunStateError,
  );

  const resumed = await resumeImportRun(pool, run.id);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.nextOffset, 3);
  assert.equal(resumed.finishedAt, null);
  assert.equal(resumed.errorMessage, null);
  assert.equal(resumed.worksFetched, 3, 'progress counters are kept');

  await savePage(pool, { runId: run.id, works: [work(3)], fetchedCount: 1, nextOffset: 4 });
  const done = await finishImportRun(pool, run.id, { status: 'succeeded' });
  assert.equal(done.status, 'succeeded');
  assert.equal(done.nextOffset, 4);
  assert.equal(done.worksFetched, 4);
  assert.equal(done.worksUpserted, 3);
  assert.ok(done.finishedAt instanceof Date);

  assert.equal(await findResumableRun(pool), null);
  await assert.rejects(resumeImportRun(pool, run.id), ImportRunStateError);
});

test('an interrupted run left in status running can be found and resumed', async () => {
  const run = await startImportRun(pool, { startOffset: 5000 });
  await savePage(pool, { runId: run.id, works: [work(1)], fetchedCount: 1000, nextOffset: 6000 });
  // simulate a crash: no finishImportRun

  const found = await findResumableRun(pool);
  assert.equal(found.id, run.id);
  assert.equal(found.status, 'running');
  assert.equal(found.nextOffset, 6000);
  const resumed = await resumeImportRun(pool, run.id);
  assert.equal(resumed.nextOffset, 6000);
});

test('findResumableRun ignores older failed runs when the latest run succeeded', async () => {
  const failed = await startImportRun(pool);
  await finishImportRun(pool, failed.id, { status: 'failed', errorMessage: 'x' });
  const ok = await startImportRun(pool);
  await finishImportRun(pool, ok.id, { status: 'succeeded' });
  assert.equal(await findResumableRun(pool), null);
});

test('findResumableRun returns null when there are no runs', async () => {
  assert.equal(await findResumableRun(pool), null);
});

test('finishImportRun refuses a run that is not running', async () => {
  const run = await startImportRun(pool);
  await finishImportRun(pool, run.id, { status: 'succeeded' });
  await assert.rejects(finishImportRun(pool, run.id, { status: 'failed' }), ImportRunStateError);
  await assert.rejects(finishImportRun(pool, 12345, { status: 'failed' }), ImportRunStateError);
});
