// Ports: the contracts the core needs, written in the core's own terms
// (architecture §5, ADR-0004). Adapters implement them; the core only ever
// receives objects of these shapes, so it never imports pg, fetch or an adapter.
// This file has no runtime code: it exists for JSDoc types and documentation.

// ---------- neutral work model (sources -> core -> repository) ----------

/**
 * A work as any source delivers it (architecture §5, "neutral work model").
 * @typedef {object} SourceWork
 * @property {string} sourceWorkId         unique within the source (IMSLP: permlink)
 * @property {string} title
 * @property {string | null} composerName
 * @property {string | null} catalogueNumber
 * @property {string | null} pageUrl       link to the work on the source's website
 * @property {Record<string, unknown>} [extra] optional source-specific values (IMSLP: imslpId, imslpPageId, parent)
 */

/**
 * One page from a source, already checked and parsed by the source adapter.
 * @typedef {object} SourcePage
 * @property {SourceWork[]} works
 * @property {{ index: number, recordId: string | null, reason: string }[]} skipped
 * @property {number} fetchedCount   raw records fetched, including skipped ones
 * @property {boolean} moreAvailable whether the source has more records after this page
 */

/**
 * Where works come from. Implemented by createImslpSource().
 * @typedef {object} CatalogSource
 * @property {string} code  the source's code in the sources table, e.g. 'imslp'
 * @property {(request: { start: number, limit: number }) => Promise<SourcePage>} fetchPage
 */

// ---------- importer persistence ----------

/**
 * @typedef {object} ImportRun
 * @property {number} id
 * @property {'running' | 'succeeded' | 'failed'} status
 * @property {number} nextOffset    where the next page must start
 * @property {number} worksFetched  raw records fetched so far
 */

/**
 * @typedef {object} SavedPage
 * @property {number} inserted
 * @property {number} updated
 * @property {number} unchanged
 * @property {number} nextOffset
 */

/**
 * Persistence for catalogue imports. Implemented by createPostgresRepository(pool).
 * A run belongs to one source; savePage only ever writes that source's works.
 * Throws ImportRunStateError / OffsetMismatchError (src/core/errors.js) when
 * another process owns the run.
 * @typedef {object} CatalogRepository
 * @property {(options?: { key?: number }) => Promise<{ release: () => Promise<void> } | null>} acquireImporterLock
 * @property {(sourceCode: string) => Promise<ImportRun | null>} findResumableRun
 *   the source's latest run if it did not succeed
 * @property {(options: { sourceCode: string, startOffset?: number }) => Promise<ImportRun>} startImportRun
 * @property {(runId: number) => Promise<ImportRun>} resumeImportRun
 * @property {(runId: number, result: { status: 'succeeded' | 'failed', errorMessage?: string | null }) => Promise<ImportRun>} finishImportRun
 * @property {(page: { runId: number, pageStart: number, works: SourceWork[], fetchedCount: number, finish?: boolean }) => Promise<SavedPage>} savePage
 *   one transaction: the works and the run's checkpoint together
 */

// ---------- catalogue (GET/POST /works, GET /sources) ----------

/**
 * A stored work as the core returns it. The HTTP adapter maps it to the API
 * `Work` (e.g. encodes pageUrl, formats dates).
 * @typedef {object} Work
 * @property {number} id
 * @property {string} title
 * @property {{ id: number, name: string } | null} composer
 * @property {string | null} catalogueNumber
 * @property {string | null} pageUrl          as stored
 * @property {{ code: string, name: string }} source
 * @property {string} sourceRecordId
 * @property {string | null} attribution      the source's attribution
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {object} Source
 * @property {string} code
 * @property {string} name
 * @property {'external' | 'manual'} kind
 * @property {string | null} homepageUrl
 * @property {string | null} attribution
 * @property {string | null} metadataLicence
 */

/**
 * Read side for works. Implemented by createPostgresWorkQueries(pool).
 * @typedef {object} WorkQueries
 * @property {(criteria: { titleContains: string | null, composerContains: string | null,
 *   hasCatalogueNumber: boolean | null, sourceCode: string | null,
 *   sort: 'title' | '-title' | 'createdAt' | '-createdAt', limit: number, offset: number })
 *   => Promise<{ works: Work[], total: number }>} listWorks
 *   case-insensitive substring filters, combined with AND; ties broken by id
 * @property {(workId: number) => Promise<Work | null>} getWork
 */

/**
 * Write side for manually added works. Implemented by createPostgresWorkCommands(pool).
 * @typedef {object} WorkCommands
 * @property {(work: { title: string, composerName: string | null, catalogueNumber: string | null,
 *   pageUrl: string | null, pageUrlKey: string | null }) => Promise<Work>} createManualWork
 *   adds a work to the source 'manual'; reuses a composer with exactly this name; throws
 *   DuplicatePageUrlError if any work already has the same pageUrlKey (checked atomically)
 */

/**
 * @typedef {object} SourceQueries
 * @property {() => Promise<Source[]>} listSources
 */

export {};
