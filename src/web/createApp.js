// Builds the Express app (ADR-0004) from injected use cases and configuration.
// Route handlers are thin: read the validated request, call one use case, map
// the result. No SQL and no business rules here.

import express from 'express';
import {
  DuplicatePageUrlError,
  WorkNotFoundError,
  WorkValidationError,
} from '../core/errors.js';
import { fingerprint } from './idempotency.js';
import { jsonBody, securityHeaders, validateQuery, writeGuard } from './middleware.js';
import { HttpProblem, problems, sendProblem } from './problems.js';
import { toApiSource, toApiWork } from './workMapper.js';

export const API_PREFIX = '/api/v1';
const LIST_PARAMS = ['q', 'composer', 'hasCatalogueNumber', 'source', 'sort', 'limit', 'offset'];

/** Relative link that repeats the current filters and sort order (PageLinks). */
function worksLink(query, offset) {
  const params = new URLSearchParams();
  for (const name of LIST_PARAMS) {
    const value = name === 'offset' ? offset : query[name];
    if (value !== undefined && value !== null) params.set(name, String(value));
  }
  return `${API_PREFIX}/works?${params}`;
}

/**
 * @param {object} deps
 * @param {{ listWorks: Function, getWork: Function, createWork: Function, listSources: Function }} deps.useCases
 *   core use cases with their ports already bound
 * @param {Awaited<ReturnType<typeof import('./contract.js').loadContract>>} deps.contract
 * @param {ReturnType<typeof import('./idempotency.js').createIdempotencyStore>} deps.idempotency
 * @param {{ writesEnabled: boolean, allowedOrigins: string[] }} deps.config
 * @param {{ error: Function }} [deps.logger]
 */
export function createApp({ useCases, contract, idempotency, config, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('query parser', 'simple'); // flat key/value pairs; repeated keys become arrays (rejected by the contract)
  app.use(securityHeaders);

  const api = express.Router();

  // ---------- GET /works ----------
  api.get('/works', validateQuery(contract, 'listWorks'), async (_req, res) => {
    const query = res.locals.query;
    const { data, page } = await useCases.listWorks(query);
    const linkQuery = { ...query, sort: query.sort ?? 'title', limit: page.limit };
    res.json({
      data: data.map(toApiWork),
      page,
      links: {
        self: worksLink(linkQuery, page.offset),
        next: page.offset + page.limit < page.total ? worksLink(linkQuery, page.offset + page.limit) : null,
        prev: page.offset > 0 ? worksLink(linkQuery, Math.max(0, page.offset - page.limit)) : null,
      },
    });
  });

  // ---------- GET /works/:workId ----------
  api.get('/works/:workId', validateQuery(contract, 'none'), async (req, res) => {
    const { errors, workId } = contract.validateWorkId(req.params.workId);
    if (errors.length) throw problems.invalidParameter(errors);
    res.json(toApiWork(await useCases.getWork(workId)));
  });

  // ---------- POST /works ----------
  api.post(
    '/works',
    writeGuard(config),
    validateQuery(contract, 'none', { malformed: true }),
    jsonBody(),
    async (req, res) => {
      const key = req.get('Idempotency-Key');
      if (key !== undefined) {
        const keyErrors = contract.validateIdempotencyKey(key);
        if (keyErrors.length) throw problems.malformed('The Idempotency-Key header is invalid.', keyErrors);
      }

      // "Leading and trailing spaces are removed before validation" (CreateWorkRequest).
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? Object.fromEntries(Object.entries(req.body).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
        : req.body;
      const errors = contract.validateCreateWork(body);
      if (errors.length) throw problems.validation(errors);

      if (key !== undefined) {
        const decision = idempotency.begin(key, fingerprint(body));
        if (decision.kind === 'mismatch') {
          throw problems.validation([{
            location: 'header', field: 'Idempotency-Key', code: 'idempotency_key_reused',
            message: 'This Idempotency-Key was already used with a different request body.',
          }]);
        }
        if (decision.kind === 'pending') throw problems.idempotencyInProgress();
        if (decision.kind === 'replay') {
          res.status(201).location(decision.response.location).set('Idempotent-Replayed', 'true').json(decision.response.body);
          return;
        }
      }

      try {
        const work = toApiWork(await useCases.createWork(body));
        const location = `${API_PREFIX}/works/${work.id}`;
        if (key !== undefined) idempotency.complete(key, { location, body: work });
        res.status(201).location(location).json(work);
      } catch (error) {
        if (key !== undefined) idempotency.release(key);
        throw error;
      }
    },
  );

  // ---------- GET /sources ----------
  api.get('/sources', validateQuery(contract, 'none'), async (_req, res) => {
    res.json({ data: (await useCases.listSources()).map(toApiSource) });
  });

  // Known paths with an unsupported method, then unknown paths.
  api.all(['/works', '/works/:workId', '/sources'], () => {
    throw problems.methodNotAllowed();
  });
  api.use(() => {
    throw problems.notFound('There is no such API resource.');
  });

  app.use(API_PREFIX, api);
  app.use((_req, _res, next) => next(problems.notFound('There is no such resource.')));

  // ---------- errors -> Problem Details ----------
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, _next) => {
    const instance = req.originalUrl;
    if (error instanceof HttpProblem) return sendProblem(res, error, instance);
    if (error instanceof WorkNotFoundError) return sendProblem(res, problems.workNotFound(error.workId), instance);
    if (error instanceof DuplicatePageUrlError) return sendProblem(res, problems.duplicateWork(error.existingWorkId), instance);
    if (error instanceof WorkValidationError) return sendProblem(res, problems.validation(error.errors), instance);
    // Unexpected: log on the server, reveal nothing to the client (ADR-0003).
    logger.error(`Unexpected error for ${req.method} ${instance}: ${error?.stack ?? error}`);
    return sendProblem(res, problems.internal(), instance);
  });

  return app;
}
