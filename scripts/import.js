// Imports IMSLP works into PostgreSQL.
//
// Usage: mise exec -- npm run import -- [--limit N] [--page-size N] [--start N] [--resume | --fresh]
// Default: fetch 10 records starting at offset 0. There is no option to import
// the whole catalogue.
//
// Exit codes: 0 succeeded, 1 import failed, 2 usage error / another import running.

// Composition root: the only place that wires adapters to the core.
import { createImslpClient } from '../src/adapters/imslp/imslpClient.js';
import { createImslpSource } from '../src/adapters/imslp/imslpSource.js';
import { createPool } from '../src/adapters/postgres/db.js';
import { createPostgresRepository } from '../src/adapters/postgres/repository.js';
import { formatSummary } from '../src/cli/formatSummary.js';
import { DEFAULT_CRAWL_DELAY_MS, USAGE, parseImportOptions, readClientOptions } from '../src/cli/importOptions.js';
import { UsageError } from '../src/core/errors.js';
import { runImport } from '../src/core/importCatalog.js';

async function main() {
  let options;
  let clientOptions;
  try {
    options = parseImportOptions(process.argv.slice(2), process.env);
    if (options.help) {
      console.log(USAGE);
      return 0;
    }
    clientOptions = readClientOptions(process.env);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }

  const client = createImslpClient(clientOptions);
  const pool = createPool();
  const repo = createPostgresRepository(pool);

  // First Ctrl+C: finish the current page, then stop (the run stays resumable).
  // Second Ctrl+C: exit immediately (safe: an uncommitted page is rolled back).
  const controller = new AbortController();
  let interrupts = 0;
  process.on('SIGINT', () => {
    interrupts += 1;
    if (interrupts === 1) {
      console.error('Interrupt received: stopping after the current page (Ctrl+C again to exit now).');
      controller.abort();
    } else {
      process.exit(130);
    }
  });

  let lock = null;
  try {
    lock = await repo.acquireImporterLock();
    if (!lock) {
      console.error('Another import is already running (importer lock is held). Nothing was changed.');
      return 2;
    }

    console.log(`Importing up to ${options.limit} records, page size ${Math.min(options.pageSize, options.limit)}.`);
    const summary = await runImport({
      source: createImslpSource({ client }),
      repo,
      options,
      signal: controller.signal,
      startupDelayMs: clientOptions.delayMs ?? DEFAULT_CRAWL_DELAY_MS,
    });
    console.log(`\n${formatSummary(summary)}`);
    return summary.status === 'succeeded' ? 0 : 1;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    console.error(`Import failed: ${error.message}`);
    return 1;
  } finally {
    await lock?.release();
    await pool.end();
  }
}

process.exitCode = await main();
