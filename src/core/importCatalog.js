// Use case: import a catalogue. Fetch a neutral page from a source -> save it with its checkpoint.
//
// Core module: the source and the repository (ports, see ports.js) are passed in, so it can be tested offline with fakes. It contains
// no SQL, no HTTP and no command-line code, and imports nothing outside src/core/.
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

import { ImportPageError, UsageError, isRunOwnedElsewhere } from './errors.js';

const MAX_SKIPPED_SAMPLES = 5;

export { ImportPageError, UsageError };

// ---------- run selection ----------

async function selectRun({ repo, source, options, log }) {
  const latest = await repo.findResumableRun(source.code);

  if (options.resume) {
    if (!latest) throw new UsageError('There is no failed or interrupted import run to resume.');
    const run = await repo.resumeImportRun(latest.id);
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
    await repo.finishImportRun(latest.id, {
      status: 'failed',
      errorMessage: 'abandoned: a new run was started with --fresh',
    });
    log(`Marked interrupted import run ${latest.id} as failed (abandoned).`);
  }
  const run = await repo.startImportRun({ sourceCode: source.code, startOffset: options.start });
  log(`Started import run ${run.id} at offset ${run.nextOffset}.`);
  return run;
}

// ---------- page checks ----------

// Source-independent safety checks on a neutral page. Source-specific checks
// (e.g. IMSLP's reported start offset) belong to the source adapter.
function checkPage(page, sourceCode, offset, requestLimit) {
  if (page === null || typeof page !== 'object' || !Array.isArray(page.works) || !Array.isArray(page.skipped)
      || !Number.isInteger(page.fetchedCount) || typeof page.moreAvailable !== 'boolean') {
    throw new ImportPageError(`source ${sourceCode} returned an unexpected page shape`);
  }
  if (page.fetchedCount > requestLimit || page.works.length > page.fetchedCount) {
    throw new ImportPageError(
      `source ${sourceCode} returned ${page.fetchedCount} records, but at most ${requestLimit} were requested`,
    );
  }
  if (page.fetchedCount === 0 && page.moreAvailable) {
    throw new ImportPageError(`source ${sourceCode} returned an empty page at offset ${offset} although it reports more results`);
  }
}

// ---------- import ----------

// Runs one import. Throws UsageError if the import cannot start (nothing is
// changed in that case). Otherwise returns a summary with status 'succeeded'
// or 'failed'; a failure is also recorded in import_runs, except when another
// process owns the run (ImportRunStateError / OffsetMismatchError).
/**
 * @param {object} deps
 * @param {import('./ports.js').CatalogSource} deps.source
 * @param {import('./ports.js').CatalogRepository} deps.repo
 */
export async function runImport({
  source,
  repo,
  options,
  log = console.log,
  signal,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  startupDelayMs = 0,
}) {
  const run = await selectRun({ repo, source, options, log });

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
      const page = await source.fetchPage({ start: offset, limit: requestLimit });
      checkPage(page, source.code, offset, requestLimit);

      const { works, skipped, fetchedCount } = page;
      const remainingAfter = remaining - fetchedCount;
      const isLastPage = remainingAfter === 0 || !page.moreAvailable;

      const saved = await repo.savePage({
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
        summary.skippedSamples.push({ offset: offset + skip.index, recordId: skip.recordId, reason: skip.reason });
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
    if (!isRunOwnedElsewhere(error)) {
      try {
        await repo.finishImportRun(run.id, { status: 'failed', errorMessage: error.message });
        summary.runMarkedFailed = true;
      } catch (finishError) {
        log(`Could not mark import run ${run.id} as failed: ${finishError.message}`);
      }
    }
    return summary;
  }
}
