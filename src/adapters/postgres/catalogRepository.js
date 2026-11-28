// PostgreSQL implementation of the catalogue ports used by GET/POST /works and
// GET /sources (ADR-0004): WorkQueries, WorkCommands, SourceQueries.
// Kept separate from the importer's CatalogRepository (interface segregation).
// Returns the core's domain objects (src/core/ports.js); the HTTP adapter maps
// them to the API shape.

import { DuplicatePageUrlError } from '../../core/errors.js';
import { withTransaction } from './db.js';

const MANUAL_SOURCE_CODE = 'manual';

// Whitelisted ORDER BY clauses; ties are broken by id ascending (contract).
const ORDER_BY = {
  title: 'w.title ASC, w.id ASC',
  '-title': 'w.title DESC, w.id ASC',
  createdAt: 'w.created_at ASC, w.id ASC',
  '-createdAt': 'w.created_at DESC, w.id ASC',
};

const WORK_SELECT = `
  SELECT w.id, w.title, w.catalogue_number, w.permlink, w.source_work_id,
         w.created_at, w.updated_at,
         c.id AS composer_id, c.name AS composer_name,
         s.code AS source_code, s.name AS source_name, s.attribution
  FROM works w
  JOIN sources s ON s.id = w.source_id
  LEFT JOIN composers c ON c.id = w.composer_id`;

const FILTERS = `
  WHERE ($1::text IS NULL OR w.title ILIKE '%' || $1 || '%' ESCAPE '\\')
    AND ($2::text IS NULL OR c.name ILIKE '%' || $2 || '%' ESCAPE '\\')
    AND ($3::boolean IS NULL OR (w.catalogue_number IS NOT NULL) = $3)
    AND ($4::text IS NULL OR s.code = $4)`;

/** Escapes LIKE wildcards so user text is matched literally. */
export function escapeLike(text) {
  return text === null ? null : text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new RangeError(`id ${value} is too large`);
  return id;
}

/** Database row -> domain Work. */
export function toWork(row) {
  return {
    id: toId(row.id),
    title: row.title,
    composer: row.composer_id === null ? null : { id: toId(row.composer_id), name: row.composer_name },
    catalogueNumber: row.catalogue_number,
    pageUrl: row.permlink,
    source: { code: row.source_code, name: row.source_name },
    sourceRecordId: row.source_work_id,
    attribution: row.attribution,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @returns {import('../../core/ports.js').WorkQueries} */
export function createPostgresWorkQueries(pool) {
  return {
    async listWorks({ titleContains, composerContains, hasCatalogueNumber, sourceCode, sort, limit, offset }) {
      const orderBy = ORDER_BY[sort];
      if (!orderBy) throw new TypeError(`unsupported sort: ${sort}`);
      const params = [escapeLike(titleContains), escapeLike(composerContains), hasCatalogueNumber, sourceCode];
      // One snapshot for the page and its total, so they never disagree.
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const page = await client.query(
          `${WORK_SELECT} ${FILTERS} ORDER BY ${orderBy} LIMIT $5 OFFSET $6`,
          [...params, limit, offset],
        );
        const count = await client.query(
          `SELECT count(*)::bigint AS total FROM works w
           JOIN sources s ON s.id = w.source_id
           LEFT JOIN composers c ON c.id = w.composer_id ${FILTERS}`,
          params,
        );
        await client.query('COMMIT');
        return { works: page.rows.map(toWork), total: toId(count.rows[0].total) };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async getWork(workId) {
      const { rows } = await pool.query(`${WORK_SELECT} WHERE w.id = $1`, [workId]);
      return rows.length === 0 ? null : toWork(rows[0]);
    },
  };
}

/** @returns {import('../../core/ports.js').WorkCommands} */
export function createPostgresWorkCommands(pool) {
  return {
    async createManualWork({ title, composerName, catalogueNumber, pageUrl, pageUrlKey }) {
      return withTransaction(pool, async (client) => {
        if (pageUrlKey !== null) {
          // Serialise creations with the same page URL, then check: the
          // duplicate rule (any source) is enforced atomically.
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [pageUrlKey]);
          const existing = await client.query('SELECT id FROM works WHERE page_url_key = $1 ORDER BY id LIMIT 1', [pageUrlKey]);
          if (existing.rows.length > 0) throw new DuplicatePageUrlError(toId(existing.rows[0].id));
        }

        let composerId = null;
        if (composerName !== null) {
          // An existing composer with exactly this name is reused (ADR-0002 section 6).
          const composer = await client.query(
            `INSERT INTO composers (name) VALUES ($1)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [composerName],
          );
          composerId = composer.rows[0].id;
        }

        const inserted = await client.query(
          `INSERT INTO works (source_id, source_work_id, title, composer_id, catalogue_number, permlink, page_url_key)
           SELECT id, gen_random_uuid()::text, $1, $2, $3, $4, $5 FROM sources WHERE code = $6
           RETURNING id`,
          [title, composerId, catalogueNumber, pageUrl, pageUrlKey, MANUAL_SOURCE_CODE],
        );
        if (inserted.rows.length === 0) throw new Error(`source '${MANUAL_SOURCE_CODE}' is missing; run the migrations`);

        const { rows } = await client.query(`${WORK_SELECT} WHERE w.id = $1`, [inserted.rows[0].id]);
        return toWork(rows[0]);
      });
    },
  };
}

/** @returns {import('../../core/ports.js').SourceQueries} */
export function createPostgresSourceQueries(pool) {
  return {
    async listSources() {
      const { rows } = await pool.query(
        `SELECT code, name, kind, homepage_url, attribution, metadata_licence
         FROM sources ORDER BY name, code`,
      );
      return rows.map((row) => ({
        code: row.code,
        name: row.name,
        kind: row.kind,
        homepageUrl: row.homepage_url,
        attribution: row.attribution,
        metadataLicence: row.metadata_licence,
      }));
    },
  };
}
