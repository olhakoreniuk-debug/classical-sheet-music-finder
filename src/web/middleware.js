// Express middleware for the security and request rules of ADR-0003 and the
// contract. No business rules here.

import express from 'express';
import { problems } from './problems.js';

export const BODY_LIMIT_BYTES = 16 * 1024;

/** nosniff on every response; no CORS headers are ever sent (ADR-0003). */
export function securityHeaders(_req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  next();
}

/** Writes must be enabled and come from an allowed origin; otherwise 403. */
export function writeGuard(config) {
  return (req, _res, next) => {
    if (!config.writesEnabled) return next(problems.writesDisabled());
    const origin = req.get('Origin');
    if (!origin || !config.allowedOrigins.includes(origin)) return next(problems.originNotAllowed());
    next();
  };
}

/** application/json only (415), at most 16 KB (413), well-formed JSON (400). */
export function jsonBody() {
  const parse = express.json({ limit: BODY_LIMIT_BYTES, strict: false, type: () => true });
  return (req, res, next) => {
    if (!req.is('application/json')) return next(problems.unsupportedMediaType());
    parse(req, res, (error) => {
      if (error) {
        if (error.type === 'entity.too.large') return next(problems.payloadTooLarge());
        if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
          return next(problems.unsupportedMediaType());
        }
        return next(problems.malformed('The request body is not valid JSON.'));
      }
      if (req.body === undefined) return next(problems.malformed('The request body is not valid JSON.'));
      next();
    });
  };
}

/** Validates and coerces req.query for an operation ('none' = no parameters allowed). */
export function validateQuery(contract, operation, { malformed = false } = {}) {
  return (req, _res, next) => {
    // Express 5's req.query is a getter; validate a copy and keep it on res.locals.
    const query = { ...req.query };
    const errors = contract.validateQuery(operation, query);
    if (errors.length) return next(malformed ? problems.malformed('This operation accepts no query parameters.', errors) : problems.invalidParameter(errors));
    _res.locals.query = query;
    next();
  };
}
