// Use case: all sources (GET /sources). Nothing about individual sources is hard-coded.

/**
 * @param {{ sourceQueries: import('../ports.js').SourceQueries }} deps
 * @returns {Promise<import('../ports.js').Source[]>}
 */
export async function listSources({ sourceQueries }) {
  return sourceQueries.listSources();
}
