// Runs the read-only checks in scripts/verify-import.sql and prints each result.
// Works the same in PowerShell and Bash (no stdin redirection, no psql needed).
//
// Usage: mise exec -- npm run verify:import

import { readFile } from 'node:fs/promises';
import { createPool } from '../src/db.js';

// Splits the file into checks at "-- check: <title>" lines.
function splitChecks(sqlText) {
  const checks = [];
  let current = null;
  for (const line of sqlText.split(/\r?\n/)) {
    const header = /^--\s*check:\s*(.+)$/.exec(line);
    if (header) {
      current = { title: header[1].trim(), sql: '' };
      checks.push(current);
    } else if (current) {
      current.sql += `${line}\n`;
    }
  }
  return checks.filter((check) => check.sql.trim() !== '');
}

const sqlText = await readFile(new URL('./verify-import.sql', import.meta.url), 'utf8');
const pool = createPool(undefined, { max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN TRANSACTION READ ONLY');
  for (const check of splitChecks(sqlText)) {
    const { rows } = await client.query(check.sql);
    console.log(`\n== ${check.title}`);
    if (rows.length === 0) console.log('(no rows)');
    else console.table(rows);
  }
  await client.query('ROLLBACK');
} catch (error) {
  console.error(`Verification failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
