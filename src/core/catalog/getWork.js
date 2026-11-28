// Use case: one work by id (GET /works/{workId}).
import { WorkNotFoundError } from '../errors.js';

/**
 * @param {{ workQueries: import('../ports.js').WorkQueries }} deps
 * @param {number} workId positive integer (validated by the HTTP adapter)
 * @returns {Promise<import('../ports.js').Work>}
 * @throws {WorkNotFoundError}
 */
export async function getWork({ workQueries }, workId) {
  if (!Number.isSafeInteger(workId) || workId < 1) throw new WorkNotFoundError(workId);
  const work = await workQueries.getWork(workId);
  if (!work) throw new WorkNotFoundError(workId);
  return work;
}
