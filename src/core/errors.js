// Errors owned by the core (architecture C1). Adapters throw them; the core and
// the driving side (CLI, later the web API) recognise them without importing an
// adapter. Plain classes, no dependencies.

// The requested operation cannot start (bad options, nothing to resume, an
// unfinished run blocks a new one). Nothing was changed. CLI exit code 2.
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

// The source returned a page the importer cannot safely save.
export class ImportPageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportPageError';
  }
}

// An import run is not in the state the operation requires (for example it is
// already finished, or another process changed it).
export class ImportRunStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportRunStateError';
  }
}

// The page does not start at the run's stored next_offset: another process
// already saved it, or the caller lost track of the offset.
export class OffsetMismatchError extends Error {
  constructor(runId, expectedOffset, actualOffset) {
    super(`import run ${runId} expects the next page at offset ${actualOffset}, `
      + `but a page starting at ${expectedOffset} was given`);
    this.name = 'OffsetMismatchError';
    this.runId = runId;
    this.pageStart = expectedOffset;
    this.storedNextOffset = actualOffset;
  }
}

/** True when another process owns the run, so this process must not mark it failed. */
export function isRunOwnedElsewhere(error) {
  return error instanceof ImportRunStateError || error instanceof OffsetMismatchError;
}

// ---------- catalogue (GET/POST /works) ----------

// No work with this id exists. HTTP adapter: 404.
export class WorkNotFoundError extends Error {
  constructor(workId) {
    super(`There is no work with id ${workId}.`);
    this.name = 'WorkNotFoundError';
    this.workId = workId;
  }
}

// Another work, from any source, already has the same page URL (ADR-0002 §4). HTTP adapter: 409.
export class DuplicatePageUrlError extends Error {
  constructor(existingWorkId) {
    super('Another work already has this page URL.');
    this.name = 'DuplicatePageUrlError';
    this.existingWorkId = existingWorkId;
  }
}

// Domain rules rejected the input. `errors` use the contract's FieldError shape
// ({ location, field, code, message }). HTTP adapter: 422.
export class WorkValidationError extends Error {
  constructor(errors) {
    super(`The work is invalid: ${errors.map((e) => e.message).join(' ')}`);
    this.name = 'WorkValidationError';
    this.errors = errors;
  }
}
