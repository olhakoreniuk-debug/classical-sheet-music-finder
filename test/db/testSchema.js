// Shared helper for integration tests: an isolated, temporary PostgreSQL schema.
//
// Not a test file itself (no ".test.js"), so `node --test` does not run it.
//
// createTestSchema() creates schema test_<16 hex chars>, builds the tables in
// it with the migration runner (the same path as real databases, ADR-0006) and returns pools whose connections use search_path = that schema
// only, so unqualified table names can never reach the application's real
// tables in "public". drop() removes the schema and asserts that the row
// counts of the real tables did not change.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createPool, readDbConfig } from '../../src/adapters/postgres/db.js';
import { runMigrations } from '../../src/adapters/postgres/migrations.js';

export const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);

const SCHEMA_PATTERN = /^test_[0-9a-f]{16}$/;
const REAL_TABLES = ['works', 'composers', 'import_runs'];

function assertTestSchemaName(name) {
  assert.match(name, SCHEMA_PATTERN, 'refusing to use a schema that is not a generated test schema');
}

async function countRealTables(adminPool) {
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

// options.migrate = false leaves the schema empty (for testing the runner itself).
export async function createTestSchema({ migrate = true } = {}) {
  const schema = `test_${randomBytes(8).toString('hex')}`;
  assertTestSchemaName(schema);
  const quotedSchema = pg.escapeIdentifier(schema);
  const config = readDbConfig();

  // Default search_path; only creates/drops the test schema and reads public counts.
  const adminPool = createPool(config, { max: 1 });
  const realCountsBefore = await countRealTables(adminPool);
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);

  const extraPools = [];
  // A pool whose every connection uses only the test schema.
  function makePool(options = {}) {
    assertTestSchemaName(schema);
    const created = createPool(config, { options: `-c search_path=${quotedSchema}`, ...options });
    extraPools.push(created);
    return created;
  }

  const pool = makePool();
  if (migrate) await runMigrations(pool, { dirUrl: MIGRATIONS_DIR });

  return {
    schema,
    quotedSchema,
    pool,
    makePool,

    async truncateAll() {
      await pool.query(
        `TRUNCATE ${quotedSchema}.works, ${quotedSchema}.composers, ${quotedSchema}.import_runs
         RESTART IDENTITY CASCADE`,
      );
    },

    async drop() {
      for (const created of extraPools) {
        if (!created.ended) await created.end();
      }
      assertTestSchemaName(schema);
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      const realCountsAfter = await countRealTables(adminPool);
      await adminPool.end();
      assert.deepEqual(realCountsAfter, realCountsBefore, 'real tables in public must not change');
    },
  };
}
