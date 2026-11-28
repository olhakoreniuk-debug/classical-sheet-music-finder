// npm run migrate: applies pending database migrations (ADR-0006).
// Composition root: reads the configuration, runs the migration runner and
// reports what happened. Never prints credentials.

import { createPool, readDbConfig } from '../src/adapters/postgres/db.js';
import { runMigrations } from '../src/adapters/postgres/migrations.js';

const MIGRATIONS_DIR = new URL('../db/migrations/', import.meta.url);

async function main() {
  const pool = createPool(readDbConfig(), { max: 1 });
  try {
    const result = await runMigrations(pool, { dirUrl: MIGRATIONS_DIR, log: (line) => console.log(line) });
    console.log(
      `Done. Baselined: ${result.baselined ? 'yes' : 'no'}. Applied: ${result.applied.length ? result.applied.join(', ') : 'none'}.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
});
