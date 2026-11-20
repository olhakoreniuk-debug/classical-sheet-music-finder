// IMSLP import pipeline: fetch a page -> parse it -> save it with its checkpoint.
//
// The API client, the parser and the repository are passed in, so this module
// can be tested offline with fakes. It contains no SQL and no HTTP code.
//
// Offsets: the next request always starts at start + RAW records fetched,
// including records the parser skipped. The repository checks that every
// page starts exactly at the run's stored next_offset.
//
// Final page: saved with finish: true, which marks the run 'succeeded' in the
// same transaction, so a crash after the last commit cannot leave a run that
// --resume would continue past the requested limit.
//
// Crawl delay: the client spaces requests within one process. Before its
// first request, the importer waits startupDelayMs as well, so two imports run
// one after another are also at least that far apart.

import { parseArgs } from 'node:util';
import { ImportRunStateError, OffsetMismatchError } from './repository.js';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT_WITHOUT_APPROVAL = 5000; // there is deliberately no --all
export const MAX_PAGE_SIZE = 1000; // IMSLP maximum
export const DEFAULT_PAGE_SIZE = 1000;
export const DEFAULT_CRAWL_DELAY_MS = 2000; // IMSLP robots.txt: Crawl-delay: 2
const MAX_SKIPPED_SAMPLES = 5;

export const USAGE = `Usage: npm run import -- [options]

  --limit N       raw IMSLP records to fetch in this run (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT_WITHOUT_APPROVAL})
  --page-size N   records per API request (default IMPORT_PAGE_SIZE or ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE})
  --start N       offset for a new run (default 0; not with --resume)
  --resume        continue the latest failed or interrupted run from its next offset
  --fresh         start a new run even if the latest run is unfinished
  --help          show this help`;

// Wrong command-line usage or an import that cannot start: exit code 2.
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

// IMSLP returned something the importer cannot safely save.
export class ImportPageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportPageError';
  }
}

// ---------- options ----------

function parseInteger(text, name, min, max) {
  const trimmed = String(text).trim();
  const number = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new UsageError(`${name} must be an integer from ${min} to ${max}, got "${text}"`);
  }
  return number;
}

// Parses command-line arguments (without "node script.js").
export function parseImportOptions(argv, env = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        limit: { type: 'string' },
        'page-size': { type: 'string' },
        start: { type: 'string' },
        resume: { type: 'boolean', default: false },
        fresh: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }

  if (values.help) return { help: true };

  const limit = values.limit === undefined
    ? DEFAULT_LIMIT
    : parseInteger(values.limit, '--limit', 1, MAX_LIMIT_WITHOUT_APPROVAL);

  let pageSize = DEFAULT_PAGE_SIZE;
  if (values['page-size'] !== undefined) {
    pageSize = parseInteger(values['page-size'], '--page-size', 1, MAX_PAGE_SIZE);
  } else if (env.IMPORT_PAGE_SIZE !== undefined && env.IMPORT_PAGE_SIZE.trim() !== '') {
    pageSize = parseInteger(env.IMPORT_PAGE_SIZE, 'IMPORT_PAGE_SIZE', 1, MAX_PAGE_SIZE);
  }

  if (values.resume && values.fresh) throw new UsageError('--resume and --fresh cannot be used together');
  if (values.resume && values.start !== undefined) {
    throw new UsageError('--start cannot be used with --resume (a resumed run continues from its own offset)');
  }
  const start = values.start === undefined
    ? 0
    : parseInteger(values.start, '--start', 0, 2_147_483_647); // import_runs offsets are INTEGER

  return { help: false, limit, pageSize, start, resume: values.resume, fresh: values.fresh };
}

// Settings for createImslpClient from the environment (undefined = client default).
export function readClientOptions(env = {}) {
  const number = (name) => {
    const value = env[name];
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new UsageError(`${name} must be a number >= 0, got "${value}"`);
    }
    return parsed;
  };
  return {
    baseUrl: env.IMSLP_BASE_URL?.trim() || undefined,
    timeoutMs: number('IMPORT_TIMEOUT_MS'),
    retries: number('IMPORT_RETRIES'),
    delayMs: number('IMPORT_DELAY_MS'),
  };
}

// ---------- run selection ----------

async function selectRun({ repo, pool, options, log }) {
  const latest = await repo.findResumableRun(pool);

  if (options.resume) {
    if (!latest) throw new UsageError('There is no failed or interrupted import run to resume.');
    const run = await repo.resumeImportRun(pool, latest.id);
    log(`Resuming import run ${run.id} (was ${latest.status}) at offset ${run.nextOffset}; `
      + `${run.worksFetched} records fetched so far.`);
    return run;
  }

  if (latest && !options.fresh) {
    throw new UsageError(
      `Import run ${latest.id} is ${latest.status} at offset ${latest.nextOffset}. `
      + 'Use --resume to continue it, or --fresh to start a new run.',
    );
  }
  if (latest && latest.status === 'running') {
    await repo.finishImportRun(pool, latest.id, {
      status: 'failed',
      errorMessage: 'abandoned: a new run was started with --fresh',
    });
    log(`Marked interrupted import run ${latest.id} as failed (abandoned).`);
  }
  const run = await repo.startImportRun(pool, { startOffset: options.start });
  log(`Started import run ${run.id} at offset ${run.nextOffset}.`);
  return run;
}

// ---------- page checks ----------

function checkPage(page, offset, requestLimit) {
  if (page === null || typeof page !== 'object' || !Array.isArray(page.works) || !page.metadata) {
    throw new ImportPageError('IMSLP client returned an unexpected page shape');
  }
  const reportedStart = Number(page.metadata.start);
  if (reportedStart !== offset) {
    throw new ImportPageError(
      `IMSLP returned a page for start=${page.metadata.start}, but start=${offset} was requested`,
    );
  }
  if (page.works.length > requestLimit) {
    throw new ImportPageError(
      `IMSLP returned ${page.works.length} records, but at most ${requestLimit} were requested`,
    );
  }
  if (page.works.length === 0 && page.metadata.moreResultsAvailable) {
    throw new ImportPageError(
      `IMSLP returned an empty page at offset ${offset} although it reports more results`,
    );
  }
}

// ---------- import ----------

// Runs one import. Throws UsageError if the import cannot start (nothing is
// changed in that case). Otherwise returns a summary with status 'succeeded'
// or 'failed'; a failure is also recorded in import_runs, except when another
// process owns the run (ImportRunStateError / OffsetMismatchError).
export async function runImport({
  pool,
  client,
  parsePage,
  repo,
  options,
  log = console.log,
  signal,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  startupDelayMs = 0,
}) {
  const run = await selectRun({ repo, pool, options, log });

  const summary = {
    runId: run.id,
    status: 'running',
    stopReason: null,
    error: null,
    runMarkedFailed: false,
    pages: 0,
    recordsFetched: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    skippedSamples: [],
    startOffset: run.nextOffset,
    nextOffset: run.nextOffset,
  };

  let offset = run.nextOffset;
  let remaining = options.limit;

  try {
    if (startupDelayMs > 0) await sleep(startupDelayMs);

    for (;;) {
      if (signal?.aborted) {
        summary.stopReason = 'interrupted';
        throw new Error('interrupted by user');
      }

      const requestLimit = Math.min(options.pageSize, remaining);
      const page = await client.fetchWorksPage({ start: offset, limit: requestLimit });
      checkPage(page, offset, requestLimit);

      const fetchedCount = page.works.length;
      const { works, skipped } = parsePage(page);
      const remainingAfter = remaining - fetchedCount;
      const isLastPage = remainingAfter === 0 || !page.metadata.moreResultsAvailable;

      const saved = await repo.savePage(pool, {
        runId: run.id, pageStart: offset, works, fetchedCount, finish: isLastPage,
      });

      summary.pages += 1;
      summary.recordsFetched += fetchedCount;
      summary.inserted += saved.inserted;
      summary.updated += saved.updated;
      summary.unchanged += saved.unchanged;
      summary.skipped += skipped.length;
      for (const skip of skipped) {
        if (summary.skippedSamples.length >= MAX_SKIPPED_SAMPLES) break;
        summary.skippedSamples.push({ offset: offset + skip.index, imslpId: skip.imslpId, reason: skip.reason });
      }
      summary.nextOffset = saved.nextOffset;

      log(`Page at offset ${offset}: fetched ${fetchedCount}, valid ${works.length} `
        + `(inserted ${saved.inserted}, updated ${saved.updated}, unchanged ${saved.unchanged}), `
        + `skipped ${skipped.length}`);

      offset = saved.nextOffset;
      remaining = remainingAfter;

      if (isLastPage) {
        summary.status = 'succeeded';
        summary.stopReason = remainingAfter === 0 ? 'limit reached' : 'end of catalogue';
        return summary;
      }
    }
  } catch (error) {
    summary.status = 'failed';
    summary.error = error.message;
    const ownedByAnotherProcess = error instanceof ImportRunStateError || error instanceof OffsetMismatchError;
    if (!ownedByAnotherProcess) {
      try {
        await repo.finishImportRun(pool, run.id, { status: 'failed', errorMessage: error.message });
        summary.runMarkedFailed = true;
      } catch (finishError) {
        log(`Could not mark import run ${run.id} as failed: ${finishError.message}`);
      }
    }
    return summary;
  }
}

// One-paragraph human-readable summary.
export function formatSummary(summary) {
  const lines = [
    `Import run ${summary.runId}: ${summary.status}`
      + (summary.stopReason ? ` (${summary.stopReason})` : ''),
    `  offsets:  ${summary.startOffset} -> ${summary.nextOffset}`,
    `  fetched:  ${summary.recordsFetched} raw records in ${summary.pages} page(s)`,
    `  works:    ${summary.inserted} inserted, ${summary.updated} updated, ${summary.unchanged} unchanged`,
    `  skipped:  ${summary.skipped}`,
  ];
  for (const sample of summary.skippedSamples) {
    lines.push(`    offset ${sample.offset} (${sample.imslpId ?? 'no id'}): ${sample.reason}`);
  }
  if (summary.error) {
    lines.push(`  error:    ${summary.error}`);
    lines.push(summary.runMarkedFailed
      ? '  The run is marked failed. Continue it with: npm run import -- --resume'
      : '  The run was NOT changed by this process (another process may own it).');
  }
  return lines.join('\n');
}
