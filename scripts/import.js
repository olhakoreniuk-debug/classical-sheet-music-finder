// Imports IMSLP works into PostgreSQL.
//
// Usage: mise exec -- npm run import -- [--limit N] [--page-size N] [--start N] [--resume | --fresh]
// Default: fetch 10 records starting at offset 0. There is no option to import
// the whole catalogue.
//
// Exit codes: 0 succeeded, 1 import failed, 2 usage error / another import running.

import { createPool } from '../src/db.js';
import { createImslpClient } from '../src/imslpClient.js';
import { parseWorksPage } from '../src/parser.js';
import * as repo from '../src/repository.js';
import {
  DEFAULT_CRAWL_DELAY_MS,
  USAGE,
  UsageError,
  formatSummary,
  parseImportOptions,
  readClientOptions,
  runImport,
} from '../src/importer.js';

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
    lock = await repo.acquireImporterLock(pool);
    if (!lock) {
      console.error('Another import is already running (importer lock is held). Nothing was changed.');
      return 2;
    }

    console.log(`Importing up to ${options.limit} records, page size ${Math.min(options.pageSize, options.limit)}.`);
    const summary = await runImport({
      pool,
      client,
      parsePage: parseWorksPage,
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
