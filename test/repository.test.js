// Offline tests for the database helpers and repository.
// No PostgreSQL: a fake pool/client records the queries it receives.
// Real database behaviour is covered by test/db/repository.db.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDbConfig, withTransaction } from '../src/db.js';
import {
  savePage,
  startImportRun,
  resumeImportRun,
  finishImportRun,
  findResumableRun,
  ImportRunStateError,
  OffsetMismatchError,
} from '../src/repository.js';

// ---------- fakes ----------

// failOn: SQL prefix (e.g. 'COMMIT') -> error to throw for that statement.
// respond(sql): optional function returning a query result.
function fakePool({ failOn = {}, respond } = {}) {
  const calls = [];
  const releases = [];
  let connects = 0;
  const client = {
    async query(sql) {
      const text = sql.trim();
      calls.push(text.split(/\s+/)[0]);
      for (const [prefix, error] of Object.entries(failOn)) {
        if (text.startsWith(prefix)) throw error;
      }
      return respond?.(text) ?? { rows: [], rowCount: 0 };
    },
    release(error) {
      releases.push(error);
    },
  };
  return {
    calls,
    releases,
    get connects() { return connects; },
    async connect() {
      connects += 1;
      return client;
    },
  };
}

const validEnv = {
  POSTGRES_USER: 'user',
  POSTGRES_PASSWORD: 'secret-password-value',
  POSTGRES_DB: 'db',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
};

function work(permlink, overrides = {}) {
  return {
    permlink,
    imslpId: `id ${permlink}`,
    title: 'Title',
    composerName: 'Bach, Johann Sebastian',
    catalogueNumber: null,
    imslpPageId: null,
    parent: null,
    ...overrides,
  };
}

// ---------- readDbConfig ----------

test('readDbConfig builds a config from environment variables', () => {
  assert.deepEqual(readDbConfig(validEnv), {
    host: 'localhost',
    port: 5432,
    user: 'user',
    password: 'secret-password-value',
    database: 'db',
  });
});

test('readDbConfig defaults host and port', () => {
  const { POSTGRES_HOST, POSTGRES_PORT, ...env } = validEnv;
  const config = readDbConfig(env);
  assert.equal(config.host, 'localhost');
  assert.equal(config.port, 5432);
});

test('readDbConfig names missing variables without leaking values', () => {
  const env = { ...validEnv, POSTGRES_USER: '', POSTGRES_DB: undefined };
  assert.throws(() => readDbConfig(env), (error) => {
    assert.match(error.message, /POSTGRES_USER, POSTGRES_DB/);
    assert.doesNotMatch(error.message, /secret-password-value/);
    return true;
  });
});

test('readDbConfig rejects an invalid port without leaking the password', () => {
  for (const port of ['abc', '0', '70000', '54.3', '-1']) {
    assert.throws(() => readDbConfig({ ...validEnv, POSTGRES_PORT: port }), (error) => {
      assert.match(error.message, /POSTGRES_PORT/);
      assert.doesNotMatch(error.message, /secret-password-value/);
      return true;
    });
  }
});

// ---------- withTransaction ----------

test('withTransaction commits, returns the result and releases the client', async () => {
  const pool = fakePool();
  const result = await withTransaction(pool, async (client) => {
    await client.query('SELECT 1');
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(pool.calls, ['BEGIN', 'SELECT', 'COMMIT']);
  assert.deepEqual(pool.releases, [undefined]);
});

test('withTransaction rolls back, re-throws and releases when fn throws', async () => {
  const pool = fakePool();
  const boom = new Error('boom');
  await assert.rejects(withTransaction(pool, async () => { throw boom; }), boom);
  assert.deepEqual(pool.calls, ['BEGIN', 'ROLLBACK']);
  assert.deepEqual(pool.releases, [undefined]);
});

test('withTransaction rolls back when COMMIT fails', async () => {
  const commitError = new Error('commit failed');
  const pool = fakePool({ failOn: { COMMIT: commitError } });
  await assert.rejects(withTransaction(pool, async () => 1), commitError);
  assert.deepEqual(pool.calls, ['BEGIN', 'COMMIT', 'ROLLBACK']);
  assert.deepEqual(pool.releases, [undefined]);
});

test('withTransaction destroys the connection if ROLLBACK fails, keeping the original error', async () => {
  const rollbackError = new Error('connection lost');
  const pool = fakePool({ failOn: { ROLLBACK: rollbackError } });
  const original = new Error('original');
  await assert.rejects(withTransaction(pool, async () => { throw original; }), original);
  assert.deepEqual(pool.releases, [rollbackError]);
});

test('withTransaction releases the client when BEGIN fails', async () => {
  const beginError = new Error('begin failed');
  const pool = fakePool({ failOn: { BEGIN: beginError } });
  let called = false;
  await assert.rejects(withTransaction(pool, async () => { called = true; }), beginError);
  assert.equal(called, false);
  assert.equal(pool.releases.length, 1);
});

// ---------- savePage validation (no connection opened) ----------

const validPage = { runId: 1, pageStart: 0, works: [work('https://imslp.org/wiki/A')], fetchedCount: 1 };

for (const [name, override, ErrorType] of [
  ['runId 0', { runId: 0 }, TypeError],
  ['runId as string', { runId: '1' }, TypeError],
  ['negative pageStart', { pageStart: -1 }, RangeError],
  ['fractional pageStart', { pageStart: 1.5 }, RangeError],
  ['missing pageStart', { pageStart: undefined }, RangeError],
  ['non-boolean finish', { finish: 'yes' }, TypeError],
  ['missing fetchedCount', { fetchedCount: undefined }, RangeError],
  ['fetchedCount below works.length', { fetchedCount: 0 }, RangeError],
  ['works not an array', { works: null }, TypeError],
  ['work without permlink', { works: [{ title: 'x' }] }, TypeError],
  ['duplicate permlinks', { works: [work('https://imslp.org/wiki/A'), work('https://imslp.org/wiki/A')], fetchedCount: 2 }, TypeError],
]) {
  test(`savePage rejects ${name} before connecting`, async () => {
    const pool = fakePool();
    await assert.rejects(savePage(pool, { ...validPage, ...override }), ErrorType);
    assert.equal(pool.connects, 0);
  });
}

// ---------- savePage transaction flow (fake database) ----------

// A fake database where run 1 has the given status and stored next_offset.
function pageResponder({ runStatus = 'running', storedOffset = 0, progressRowCount = 1 } = {}) {
  return (sql) => {
    if (sql.startsWith('SELECT status')) {
      const rows = runStatus ? [{ status: runStatus, next_offset: storedOffset }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('INSERT INTO composers')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO works')) return { rows: [{ inserted: true }], rowCount: 1 };
    if (sql.startsWith('UPDATE import_runs')) return { rows: [], rowCount: progressRowCount };
    return undefined;
  };
}

test('savePage locks the run, then writes composers, works and progress in one transaction', async () => {
  const pool = fakePool({ respond: pageResponder() });
  const result = await savePage(pool, validPage);
  assert.deepEqual(pool.calls, ['BEGIN', 'SELECT', 'INSERT', 'INSERT', 'UPDATE', 'COMMIT']);
  assert.deepEqual(result, {
    inserted: 1, updated: 0, unchanged: 0, composersInserted: 1, nextOffset: 1, finished: false,
  });
  assert.deepEqual(pool.releases, [undefined]);
});

test('savePage with no works only advances progress by the raw count', async () => {
  const pool = fakePool({ respond: pageResponder({ storedOffset: 10 }) });
  const result = await savePage(pool, { runId: 1, pageStart: 10, works: [], fetchedCount: 5 });
  assert.deepEqual(pool.calls, ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
  assert.deepEqual(result, {
    inserted: 0, updated: 0, unchanged: 0, composersInserted: 0, nextOffset: 15, finished: false,
  });
});

test('savePage rejects a page that does not start at the stored next_offset, before writing', async () => {
  const pool = fakePool({ respond: pageResponder({ storedOffset: 20 }) });
  await assert.rejects(savePage(pool, { ...validPage, pageStart: 10 }), (error) => {
    assert.ok(error instanceof OffsetMismatchError);
    assert.equal(error.pageStart, 10);
    assert.equal(error.storedNextOffset, 20);
    return true;
  });
  assert.deepEqual(pool.calls, ['BEGIN', 'SELECT', 'ROLLBACK']);
  assert.deepEqual(pool.releases, [undefined]);
});

for (const runStatus of ['failed', 'succeeded', null]) {
  test(`savePage rolls back without writing when the run is ${runStatus ?? 'missing'}`, async () => {
    const pool = fakePool({ respond: pageResponder({ runStatus }) });
    await assert.rejects(savePage(pool, validPage), ImportRunStateError);
    assert.deepEqual(pool.calls, ['BEGIN', 'SELECT', 'ROLLBACK']);
    assert.deepEqual(pool.releases, [undefined]);
  });
}

test('savePage rolls back its writes if the progress update matches no row', async () => {
  const pool = fakePool({ respond: pageResponder({ progressRowCount: 0 }) });
  await assert.rejects(savePage(pool, validPage), ImportRunStateError);
  assert.deepEqual(pool.calls, ['BEGIN', 'SELECT', 'INSERT', 'INSERT', 'UPDATE', 'ROLLBACK']);
  assert.deepEqual(pool.releases, [undefined]);
});

// ---------- run functions validation ----------

test('run functions validate their arguments', async () => {
  const db = { query: async () => assert.fail('must not query') };
  await assert.rejects(startImportRun(db, { startOffset: -1 }), RangeError);
  await assert.rejects(resumeImportRun(db, 0), TypeError);
  await assert.rejects(finishImportRun(db, 1, { status: 'running' }), TypeError);
  await assert.rejects(finishImportRun(db, 'x', { status: 'failed' }), TypeError);
});

test('findResumableRun ignores a latest run that succeeded', async () => {
  const db = { query: async () => ({ rows: [{ id: '3', status: 'succeeded', start_offset: 0, next_offset: 9 }] }) };
  assert.equal(await findResumableRun(db), null);
});
