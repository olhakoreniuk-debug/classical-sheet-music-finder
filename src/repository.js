// PostgreSQL repository: saves parsed works and composers and tracks import runs.
//
// Input is the parser's work objects:
//   { permlink, imslpId, title, composerName, catalogueNumber, imslpPageId, parent }
// This module does not import the API client or the parser.
//
// Consistency model
// -----------------
// One page = one transaction. savePage() writes composers, works AND the run's
// progress (next_offset, counters) in the same transaction, so either all of a
// page is stored together with its checkpoint, or nothing is. A failed page
// never advances next_offset.
//
// Duplicates
// ----------
// Within a page: rejected (the parser already removes them).
// Across pages and runs: ON CONFLICT (permlink) / ON CONFLICT (name) update or
// keep the existing row, so re-processing a page is always safe.
//
// Run lifecycle
// -------------
//   startImportRun()   -> status 'running'
//   savePage() ...     -> only allowed while 'running'
//   finishImportRun()  -> 'succeeded' or 'failed'
//   findResumableRun() -> latest run, if it is not 'succeeded'
//   resumeImportRun()  -> 'failed' (or interrupted 'running') back to 'running';
//                         the importer continues from its next_offset.

import { withTransaction } from './db.js';

const FINISHED_STATUSES = new Set(['succeeded', 'failed']);

export class ImportRunStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportRunStateError';
  }
}

// ---------- validation ----------

function assertRunId(runId) {
  if (!Number.isSafeInteger(runId) || runId < 1) {
    throw new TypeError(`runId must be a positive integer, got ${runId}`);
  }
}

function assertOffset(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be an integer >= 0, got ${value}`);
  }
}

function assertWorks(works, fetchedCount) {
  if (!Array.isArray(works)) throw new TypeError('works must be an array');
  if (works.length > fetchedCount) {
    throw new RangeError(`fetchedCount (${fetchedCount}) is smaller than works.length (${works.length})`);
  }
  const seen = new Set();
  works.forEach((work, index) => {
    if (work === null || typeof work !== 'object') {
      throw new TypeError(`works[${index}] is not an object`);
    }
    if (typeof work.permlink !== 'string' || work.permlink === '') {
      throw new TypeError(`works[${index}].permlink must be a non-empty string`);
    }
    // A multi-row INSERT ... ON CONFLICT DO UPDATE cannot touch one key twice.
    if (seen.has(work.permlink)) {
      throw new TypeError(`duplicate permlink in page: ${work.permlink}`);
    }
    seen.add(work.permlink);
  });
}

// ---------- row mapping ----------

function toRun(row) {
  return {
    id: Number(row.id), // BIGINT arrives as a string; run ids stay far below 2^53
    status: row.status,
    startOffset: row.start_offset,
    nextOffset: row.next_offset ?? row.start_offset,
    worksFetched: row.works_fetched,
    worksUpserted: row.works_upserted,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  };
}

const RUN_COLUMNS = `id, status, start_offset, next_offset, works_fetched,
  works_upserted, started_at, finished_at, error_message`;

// ---------- import runs ----------

// Creates a new run in status 'running', starting at startOffset.
export async function startImportRun(db, { startOffset = 0 } = {}) {
  assertOffset(startOffset, 'startOffset');
  const { rows } = await db.query(
    `INSERT INTO import_runs (start_offset, next_offset)
     VALUES ($1, $1)
     RETURNING ${RUN_COLUMNS}`,
    [startOffset],
  );
  return toRun(rows[0]);
}

// Returns the most recent run if it still needs work ('running' after a crash,
// or 'failed'), otherwise null. Only the latest run counts: if it succeeded,
// older failed runs are history, not something to resume.
export async function findResumableRun(db) {
  const { rows } = await db.query(
    `SELECT ${RUN_COLUMNS} FROM import_runs ORDER BY id DESC LIMIT 1`,
  );
  if (rows.length === 0 || rows[0].status === 'succeeded') return null;
  return toRun(rows[0]);
}

// Puts a 'failed' or interrupted 'running' run back into 'running' so that
// savePage() accepts it again. finished_at and error_message are cleared
// because they described the previous attempt. Progress (next_offset,
// counters) is kept: the importer continues from next_offset.
export async function resumeImportRun(db, runId) {
  assertRunId(runId);
  const { rows } = await db.query(
    `UPDATE import_runs
     SET status = 'running', finished_at = NULL, error_message = NULL
     WHERE id = $1 AND status IN ('running', 'failed')
     RETURNING ${RUN_COLUMNS}`,
    [runId],
  );
  if (rows.length === 0) {
    throw new ImportRunStateError(`import run ${runId} does not exist or has already succeeded`);
  }
  return toRun(rows[0]);
}

// Marks a running run as 'succeeded' or 'failed'.
export async function finishImportRun(db, runId, { status, errorMessage = null }) {
  assertRunId(runId);
  if (!FINISHED_STATUSES.has(status)) {
    throw new TypeError(`status must be 'succeeded' or 'failed', got ${status}`);
  }
  const { rows } = await db.query(
    `UPDATE import_runs
     SET status = $2, finished_at = now(), error_message = $3
     WHERE id = $1 AND status = 'running'
     RETURNING ${RUN_COLUMNS}`,
    [runId, status, errorMessage],
  );
  if (rows.length === 0) {
    throw new ImportRunStateError(`import run ${runId} does not exist or is not running`);
  }
  return toRun(rows[0]);
}

// ---------- pages ----------

const LOCK_RUN_SQL = 'SELECT status FROM import_runs WHERE id = $1 FOR UPDATE';

const UPSERT_COMPOSERS_SQL = `
  INSERT INTO composers (name)
  SELECT name FROM unnest($1::text[]) AS u(name)
  ON CONFLICT (name) DO NOTHING`;

// The WHERE clause skips rows whose data did not change, so they are not
// rewritten and keep their updated_at / last_import_run_id.
// RETURNING (xmax = 0): a freshly inserted row has xmax 0; a row updated via
// ON CONFLICT DO UPDATE has a non-zero xmax. Rows skipped by the WHERE clause
// are not returned at all.
const UPSERT_WORKS_SQL = `
  INSERT INTO works AS w
    (permlink, imslp_id, title, composer_id, catalogue_number,
     imslp_page_id, parent, last_import_run_id)
  SELECT u.permlink, u.imslp_id, u.title, c.id, u.catalogue_number,
         u.imslp_page_id, u.parent, $8::bigint
  FROM unnest($1::text[], $2::text[], $3::text[], $4::text[],
              $5::text[], $6::bigint[], $7::text[])
       AS u(permlink, imslp_id, title, composer_name, catalogue_number,
            imslp_page_id, parent)
  LEFT JOIN composers c ON c.name = u.composer_name
  ON CONFLICT (permlink) DO UPDATE SET
    imslp_id           = EXCLUDED.imslp_id,
    title              = EXCLUDED.title,
    composer_id        = EXCLUDED.composer_id,
    catalogue_number   = EXCLUDED.catalogue_number,
    imslp_page_id      = EXCLUDED.imslp_page_id,
    parent             = EXCLUDED.parent,
    last_import_run_id = EXCLUDED.last_import_run_id,
    updated_at         = now()
  WHERE (w.imslp_id, w.title, w.composer_id, w.catalogue_number,
         w.imslp_page_id, w.parent)
        IS DISTINCT FROM
        (EXCLUDED.imslp_id, EXCLUDED.title, EXCLUDED.composer_id,
         EXCLUDED.catalogue_number, EXCLUDED.imslp_page_id, EXCLUDED.parent)
  RETURNING (xmax = 0) AS inserted`;

const UPDATE_PROGRESS_SQL = `
  UPDATE import_runs
  SET next_offset    = $2,
      works_fetched  = works_fetched + $3,
      works_upserted = works_upserted + $4
  WHERE id = $1 AND status = 'running'`;

// Saves one parsed page and advances the run's checkpoint, atomically.
//
//   works        parsed works of the page (may be empty)
//   fetchedCount number of RAW records the API returned for this page,
//                including records the parser skipped
//   nextOffset   API offset of the next page = page start + fetchedCount
//                (raw count, NOT works.length, so skipped records are not
//                fetched again and nothing after them is missed)
//
// Returns { inserted, updated, unchanged, composersInserted }.
export async function savePage(pool, { runId, works, fetchedCount, nextOffset }) {
  // Validate before touching the database.
  assertRunId(runId);
  assertOffset(fetchedCount, 'fetchedCount');
  assertOffset(nextOffset, 'nextOffset');
  assertWorks(works, fetchedCount);

  const composerNames = [...new Set(
    works.map((work) => work.composerName).filter((name) => name !== null && name !== undefined),
  )];

  return withTransaction(pool, async (client) => {
    // Lock the run row first: fails fast for an unknown or finished run, and
    // serializes concurrent savePage calls for the same run.
    const lock = await client.query(LOCK_RUN_SQL, [runId]);
    if (lock.rows.length === 0 || lock.rows[0].status !== 'running') {
      throw new ImportRunStateError(`import run ${runId} does not exist or is not running`);
    }

    let composersInserted = 0;
    if (composerNames.length > 0) {
      const result = await client.query(UPSERT_COMPOSERS_SQL, [composerNames]);
      composersInserted = result.rowCount;
    }

    let inserted = 0;
    let updated = 0;
    if (works.length > 0) {
      const { rows } = await client.query(UPSERT_WORKS_SQL, [
        works.map((work) => work.permlink),
        works.map((work) => work.imslpId),
        works.map((work) => work.title),
        works.map((work) => work.composerName ?? null),
        works.map((work) => work.catalogueNumber ?? null),
        works.map((work) => work.imslpPageId ?? null),
        works.map((work) => work.parent ?? null),
        runId,
      ]);
      for (const row of rows) {
        if (row.inserted) inserted += 1;
        else updated += 1;
      }
    }

    // Last step. The status condition is a second guard (the row is already
    // locked); any failure here rolls back the composer and work writes too.
    const progress = await client.query(UPDATE_PROGRESS_SQL, [
      runId, nextOffset, fetchedCount, inserted + updated,
    ]);
    if (progress.rowCount !== 1) {
      throw new ImportRunStateError(`import run ${runId} does not exist or is not running`);
    }

    return { inserted, updated, unchanged: works.length - inserted - updated, composersInserted };
  });
}
