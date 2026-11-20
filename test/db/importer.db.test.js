// Integration tests for the import pipeline: real parser + real repository +
// real PostgreSQL (temporary schema), with a FAKE IMSLP client (no network).
//
// Run with: mise exec -- npm run test:db

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { createTestSchema } from './testSchema.js';
import { runImport, UsageError } from '../../src/importer.js';
import { parseWorksPage } from '../../src/parser.js';
import * as repo from '../../src/repository.js';

let db;
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

// ---------- fake IMSLP ----------

function rawRecord(n) {
  const composer = n % 4 === 3 ? undefined : `Composer ${n % 3}`; // some works without composer
  return {
    id: `Work ${n}`,
    type: '2',
    parent: composer ? `Category:${composer}` : '',
    intvals: { composer, worktitle: `Work ${n}`, icatno: n % 2 ? `Op.${n}` : '', pageid: String(500 + n) },
    permlink: `https://imslp.org/wiki/Work_${n}`,
  };
}

// failOnRequest: request number (1-based) that throws, like an API failure after retries.
function fakeClient(total, { failOnRequest } = {}) {
  const requests = [];
  return {
    requests,
    async fetchWorksPage({ start, limit }) {
      requests.push({ start, limit });
      if (requests.length === failOnRequest) throw new Error('HTTP 503 (gave up after 4 attempts)');
      const count = Math.max(0, Math.min(limit, total - start));
      return {
        works: Array.from({ length: count }, (_, i) => rawRecord(start + i)),
        metadata: { start, limit, moreResultsAvailable: start + count < total, timestamp: 1795208110 },
      };
    },
  };
}

function importOnce(client, options = {}) {
  return runImport({
    pool,
    client,
    parsePage: parseWorksPage,
    repo,
    options: { limit: 10, pageSize: 1000, start: 0, resume: false, fresh: false, ...options },
    log: () => {},
  });
}

async function query(sql, params) {
  return (await pool.query(sql, params)).rows;
}

async function fingerprint() {
  const [row] = await query(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(w::text, '|' ORDER BY w.id), '')) AS md5
     FROM works w`,
  );
  return row;
}

// ---------- tests ----------

test('end to end: 10 records -> 10 works, composers, run succeeded at offset 10', async () => {
  const summary = await importOnce(fakeClient(100));
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.inserted, 10);

  const [counts] = await query(
    `SELECT (SELECT count(*)::int FROM works) AS works,
            (SELECT count(DISTINCT permlink)::int FROM works) AS distinct_permlinks,
            (SELECT count(*)::int FROM composers) AS composers,
            (SELECT count(*)::int FROM works WHERE composer_id IS NULL) AS no_composer`,
  );
  assert.deepEqual(counts, { works: 10, distinct_permlinks: 10, composers: 3, no_composer: 2 });

  const runs = await query('SELECT * FROM import_runs');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'succeeded');
  assert.equal(runs[0].start_offset, 0);
  assert.equal(runs[0].next_offset, 10);
  assert.equal(runs[0].works_fetched, 10);
  assert.equal(runs[0].works_upserted, 10);
  assert.ok(runs[0].finished_at instanceof Date);
  assert.equal(runs[0].error_message, null);
});

test('idempotency: the same import twice changes nothing the second time', async () => {
  await importOnce(fakeClient(100));
  const before = await fingerprint();
  const composersBefore = await query('SELECT id, name FROM composers ORDER BY id');

  const second = await importOnce(fakeClient(100));
  assert.equal(second.status, 'succeeded');
  assert.deepEqual([second.inserted, second.updated, second.unchanged], [0, 0, 10]);

  assert.deepEqual(await fingerprint(), before, 'works table is byte-for-byte identical');
  assert.deepEqual(await query('SELECT id, name FROM composers ORDER BY id'), composersBefore);
  const runs = await query('SELECT id, status, works_fetched, works_upserted FROM import_runs ORDER BY id');
  assert.deepEqual(runs.map((r) => [Number(r.id), r.status, r.works_fetched, r.works_upserted]),
    [[1, 'succeeded', 10, 10], [2, 'succeeded', 10, 0]]);
  const [{ runs_used: runsUsed }] = await query(
    'SELECT array_agg(DISTINCT last_import_run_id::int) AS runs_used FROM works',
  );
  assert.deepEqual(runsUsed, [1], 'unchanged works keep the run that inserted them');
});

test('failure on page 2, then --resume: no duplicates, one run with correct totals', async () => {
  const failed = await importOnce(fakeClient(100, { failOnRequest: 2 }), { limit: 30, pageSize: 10 });
  assert.equal(failed.status, 'failed');
  let [run] = await query('SELECT * FROM import_runs');
  assert.equal(run.status, 'failed');
  assert.equal(run.next_offset, 10);
  assert.match(run.error_message, /HTTP 503/);
  assert.equal((await query('SELECT count(*)::int AS n FROM works'))[0].n, 10);

  // Without --resume or --fresh the importer refuses.
  await assert.rejects(importOnce(fakeClient(100)), UsageError);

  const client = fakeClient(100);
  const resumed = await importOnce(client, { resume: true, limit: 20, pageSize: 10 });
  assert.equal(resumed.status, 'succeeded');
  assert.deepEqual(client.requests, [{ start: 10, limit: 10 }, { start: 20, limit: 10 }]);

  [run] = await query('SELECT * FROM import_runs');
  assert.equal(run.status, 'succeeded');
  assert.equal(run.next_offset, 30);
  assert.equal(run.works_fetched, 30);
  assert.equal(run.works_upserted, 30);
  assert.equal(run.error_message, null);
  const [counts] = await query('SELECT count(*)::int AS n, count(DISTINCT permlink)::int AS d FROM works');
  assert.deepEqual(counts, { n: 30, d: 30 });
});

test('crash after the final page commit: --resume finds nothing and fetches nothing', async () => {
  // Simulate the process dying right after the final page's transaction committed.
  const crashingRepo = {
    ...repo,
    async savePage(...args) {
      const result = await repo.savePage(...args);
      if (args[1].finish) throw new Error('process killed');
      return result;
    },
  };
  await runImport({
    pool, client: fakeClient(100), parsePage: parseWorksPage, repo: crashingRepo,
    options: { limit: 10, pageSize: 1000, start: 0, resume: false, fresh: false }, log: () => {},
  });

  const [run] = await query('SELECT status, next_offset, works_fetched FROM import_runs');
  assert.deepEqual(run, { status: 'succeeded', next_offset: 10, works_fetched: 10 });

  const client = fakeClient(100);
  await assert.rejects(importOnce(client, { resume: true }), UsageError);
  assert.equal(client.requests.length, 0, 'no records beyond the requested 10');
  assert.equal((await query('SELECT count(*)::int AS n FROM works'))[0].n, 10);
});

test('crash mid-page (before commit) leaves no partial data; resume refetches that page', async () => {
  const crashingRepo = {
    ...repo,
    async savePage(poolArg, args) {
      if (args.pageStart === 10) {
        // a bad row makes the transaction fail after the composer insert
        return repo.savePage(poolArg, { ...args, works: [...args.works, { ...args.works[0], permlink: 'x', title: null }] });
      }
      return repo.savePage(poolArg, args);
    },
  };
  const summary = await runImport({
    pool, client: fakeClient(100), parsePage: parseWorksPage, repo: crashingRepo,
    options: { limit: 20, pageSize: 10, start: 0, resume: false, fresh: false }, log: () => {},
  });
  assert.equal(summary.status, 'failed');
  const [run] = await query('SELECT status, next_offset FROM import_runs');
  assert.deepEqual(run, { status: 'failed', next_offset: 10 });
  assert.equal((await query('SELECT count(*)::int AS n FROM works'))[0].n, 10);

  const client = fakeClient(100);
  const resumed = await importOnce(client, { resume: true, limit: 10, pageSize: 10 });
  assert.equal(resumed.status, 'succeeded');
  assert.deepEqual(client.requests, [{ start: 10, limit: 10 }]);
  assert.equal((await query('SELECT count(*)::int AS n FROM works'))[0].n, 20);
});

test('a second importer cannot take the lock while the first holds it', async () => {
  const key = randomInt(1, 2 ** 40); // never the real importer's key
  const first = await repo.acquireImporterLock(pool, { key });
  try {
    const otherPool = db.makePool({ max: 2 }); // a separate "process"
    const second = await repo.acquireImporterLock(otherPool, { key });
    assert.equal(second, null);
    await otherPool.end();
  } finally {
    await first.release();
  }
  assert.equal((await query('SELECT count(*)::int AS n FROM import_runs'))[0].n, 0);
});
