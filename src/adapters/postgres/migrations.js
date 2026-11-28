// Schema migration runner (ADR-0006).
//
// Versioned SQL files in db/migrations/ named NNNN_name.sql are applied in
// order, each in its own transaction, and recorded in schema_migrations with
// a SHA-256 checksum. An applied file that later changes stops the runner.
//
// Baseline: a database created before migrations existed already has the
// tables of 0001. If schema_migrations is empty and those tables and columns
// all exist, 0001 is recorded as applied without running it, so the existing
// data is never touched. If only some of them exist, the runner stops.
//
// Works on the connection's current schema (tests use a temporary schema via
// search_path). Knows nothing about IMSLP beyond the baseline table list.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
export const BASELINE_VERSION = '0001';

// Tables and columns created by 0001_baseline.sql.
export const BASELINE_TABLES = {
  import_runs: ['id', 'started_at', 'finished_at', 'status', 'start_offset', 'next_offset', 'works_fetched', 'works_upserted', 'error_message'],
  composers: ['id', 'name', 'created_at'],
  works: ['id', 'permlink', 'imslp_id', 'title', 'composer_id', 'catalogue_number', 'imslp_page_id', 'parent', 'last_import_run_id', 'created_at', 'updated_at'],
};

// Serialises concurrent runs (two terminals running `npm run migrate`).
const LOCK_KEY = 726_354_812;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    checksum    TEXT NOT NULL,
    baselined   BOOLEAN NOT NULL DEFAULT false,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

/** SHA-256 of the file text with line endings normalised, so Git's CRLF conversion does not change it. */
export function checksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Reads db/migrations/: every .sql file must match NNNN_name.sql; versions must be unique. */
export async function loadMigrations(dirUrl) {
  const names = (await readdir(dirUrl)).filter((name) => name.endsWith('.sql')).sort();
  const migrations = [];
  for (const file of names) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`Invalid migration file name "${file}": expected NNNN_name.sql (lower case).`);
    const [, version, name] = match;
    if (migrations.some((m) => m.version === version)) throw new Error(`Duplicate migration version ${version}.`);
    const sql = await readFile(new URL(file, dirUrl), 'utf8');
    migrations.push({ version, name, file, sql, checksum: checksum(sql) });
  }
  return migrations;
}

/**
 * Compares the files with the recorded rows and returns the migrations still to apply.
 * Throws if an applied migration was changed or deleted.
 */
export function pendingMigrations(migrations, appliedRows) {
  const byVersion = new Map(migrations.map((m) => [m.version, m]));
  for (const row of appliedRows) {
    const file = byVersion.get(row.version);
    if (!file) throw new Error(`Migration ${row.version} is recorded as applied but its file is missing.`);
    if (file.checksum !== row.checksum) {
      throw new Error(`Migration ${file.file} was changed after it was applied. Restore it and add a new migration instead.`);
    }
  }
  const applied = new Set(appliedRows.map((row) => row.version));
  return migrations.filter((m) => !applied.has(m.version));
}

/** 'empty' (none of the baseline tables), 'complete' (all tables with all columns) or 'partial'. */
async function inspectBaseline(client) {
  const { rows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [Object.keys(BASELINE_TABLES)],
  );
  if (rows.length === 0) return { state: 'empty', missing: [] };
  const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  const missing = Object.entries(BASELINE_TABLES).flatMap(([table, columns]) =>
    columns.map((column) => `${table}.${column}`).filter((key) => !present.has(key)),
  );
  return { state: missing.length === 0 ? 'complete' : 'partial', missing };
}

async function inTransaction(client, fn) {
  await client.query('BEGIN');
  try {
    await fn();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Brings the database's current schema up to date.
 * @returns {{ baselined: boolean, applied: string[] }} what was done
 */
export async function runMigrations(pool, { dirUrl, log = () => undefined }) {
  const migrations = await loadMigrations(dirUrl);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(CREATE_TABLE_SQL);

    let baselined = false;
    let { rows: appliedRows } = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version');

    if (appliedRows.length === 0) {
      const { state, missing } = await inspectBaseline(client);
      if (state === 'partial') {
        throw new Error(`The database has only part of the baseline schema (missing: ${missing.join(', ')}). Nothing was changed.`);
      }
      if (state === 'complete') {
        const baseline = migrations.find((m) => m.version === BASELINE_VERSION);
        if (!baseline) throw new Error(`Baseline migration ${BASELINE_VERSION} is missing.`);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum, baselined) VALUES ($1, $2, $3, true)',
          [baseline.version, baseline.name, baseline.checksum],
        );
        baselined = true;
        log(`Baselined ${baseline.file}: existing tables found, recorded as applied without running it.`);
        appliedRows = [{ version: baseline.version, checksum: baseline.checksum }];
      }
    }

    const pending = pendingMigrations(migrations, appliedRows);
    for (const migration of pending) {
      await inTransaction(client, async () => {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
      });
      log(`Applied ${migration.file}`);
    }
    if (pending.length === 0) log('Database schema is up to date.');
    return { baselined, applied: pending.map((m) => m.version) };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
