// Integration tests for the migration runner, each in its own temporary schema.
// The real tables in "public" are never touched (checked by drop()).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { runMigrations } from '../../src/adapters/postgres/migrations.js';
import { createTestSchema, MIGRATIONS_DIR } from './testSchema.js';

const baselineSql = () => readFile(new URL('0001_baseline.sql', MIGRATIONS_DIR), 'utf8');

async function recorded(pool) {
  const { rows } = await pool.query('SELECT version, baselined FROM schema_migrations ORDER BY version');
  return rows;
}

test('a new, empty schema is created by running all migrations, and a second run changes nothing', async () => {
  const db = await createTestSchema({ migrate: false });
  try {
    assert.deepEqual(await runMigrations(db.pool, { dirUrl: MIGRATIONS_DIR }), { baselined: false, applied: ['0001', '0002'] });
    await db.pool.query("INSERT INTO composers (name) VALUES ('Schubert, Franz')");
    assert.deepEqual(await runMigrations(db.pool, { dirUrl: MIGRATIONS_DIR }), { baselined: false, applied: [] });
    assert.deepEqual(await recorded(db.pool), [{ version: '0001', baselined: false }, { version: '0002', baselined: false }]);
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM composers');
    assert.equal(rows[0].n, 1);
  } finally {
    await db.drop();
  }
});

test('an existing populated schema is baselined at 0001, then 0002 keeps its rows as IMSLP works', async () => {
  const db = await createTestSchema({ migrate: false });
  try {
    // A database created before migrations existed: tables and data, no schema_migrations.
    await db.pool.query(await baselineSql());
    await db.pool.query("INSERT INTO composers (name) VALUES ('Brahms, Johannes')");
    await db.pool.query(
      "INSERT INTO works (permlink, imslp_id, title, composer_id) VALUES ('https://imslp.org/wiki/X', 'X', 'Wiegenlied', 1)",
    );

    await db.pool.query("INSERT INTO import_runs (status) VALUES ('succeeded')");

    assert.deepEqual(await runMigrations(db.pool, { dirUrl: MIGRATIONS_DIR }), { baselined: true, applied: ['0002'] });
    assert.deepEqual(await runMigrations(db.pool, { dirUrl: MIGRATIONS_DIR }), { baselined: false, applied: [] });
    assert.deepEqual(await recorded(db.pool), [{ version: '0001', baselined: true }, { version: '0002', baselined: false }]);

    const { rows } = await db.pool.query(
      `SELECT w.id::int, w.title, w.permlink, w.source_work_id, w.page_url_key, s.code
       FROM works w JOIN sources s ON s.id = w.source_id`,
    );
    assert.deepEqual(rows, [{
      id: 1, title: 'Wiegenlied', permlink: 'https://imslp.org/wiki/X', source_work_id: 'https://imslp.org/wiki/X',
      page_url_key: 'https://imslp.org/wiki/X', code: 'imslp',
    }]);
    const runs = await db.pool.query('SELECT s.code FROM import_runs r JOIN sources s ON s.id = r.source_id');
    assert.deepEqual(runs.rows, [{ code: 'imslp' }]);
  } finally {
    await db.drop();
  }
});

test('a schema with only part of the baseline tables is refused and nothing is recorded', async () => {
  const db = await createTestSchema({ migrate: false });
  try {
    await db.pool.query('CREATE TABLE composers (id BIGINT PRIMARY KEY, name TEXT NOT NULL)');
    await assert.rejects(runMigrations(db.pool, { dirUrl: MIGRATIONS_DIR }), /only part of the baseline schema/);
    assert.deepEqual(await recorded(db.pool), []);
  } finally {
    await db.drop();
  }
});

test('a migration file changed after it was applied stops the runner', async () => {
  const db = await createTestSchema({ migrate: false });
  const dir = await mkdtemp(join(tmpdir(), 'migrations-'));
  try {
    const dirUrl = pathToFileURL(`${dir}/`);
    await writeFile(join(dir, '0001_baseline.sql'), await baselineSql());
    await runMigrations(db.pool, { dirUrl });
    await writeFile(join(dir, '0001_baseline.sql'), `${await baselineSql()}\n-- edited`);
    await assert.rejects(runMigrations(db.pool, { dirUrl }), /was changed after it was applied/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await db.drop();
  }
});
