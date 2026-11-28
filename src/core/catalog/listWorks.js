// Use case: list works (GET /works). Applies the contract's defaults and passes
// normalised criteria to the WorkQueries port. Request validation (types,
// ranges, unknown parameters) is the HTTP adapter's job, from openapi.yaml.

export const WORK_SORTS = ['title', '-title', 'createdAt', '-createdAt'];
export const DEFAULT_SORT = 'title';
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

function optionalText(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * @param {{ workQueries: import('../ports.js').WorkQueries }} deps
 * @param {{ q?: string, composer?: string, hasCatalogueNumber?: boolean, source?: string,
 *           sort?: string, limit?: number, offset?: number }} [criteria]
 * @returns {Promise<{ data: import('../ports.js').Work[], page: { limit: number, offset: number, total: number } }>}
 */
export async function listWorks({ workQueries }, criteria = {}) {
  const sort = criteria.sort ?? DEFAULT_SORT;
  const limit = criteria.limit ?? DEFAULT_LIMIT;
  const offset = criteria.offset ?? 0;
  if (!WORK_SORTS.includes(sort)) throw new TypeError(`sort must be one of ${WORK_SORTS.join(', ')}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new TypeError(`limit must be 1-${MAX_LIMIT}`);
  if (!Number.isInteger(offset) || offset < 0) throw new TypeError('offset must be an integer >= 0');
  const hasCatalogueNumber = criteria.hasCatalogueNumber ?? null;
  if (hasCatalogueNumber !== null && typeof hasCatalogueNumber !== 'boolean') {
    throw new TypeError('hasCatalogueNumber must be a boolean');
  }

  const { works, total } = await workQueries.listWorks({
    titleContains: optionalText(criteria.q),
    composerContains: optionalText(criteria.composer),
    hasCatalogueNumber,
    sourceCode: optionalText(criteria.source),
    sort,
    limit,
    offset,
  });
  return { data: works, page: { limit, offset, total } };
}
