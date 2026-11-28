// Request and response validation derived from openapi.yaml (ADR-0004): the
// contract is the single source of truth for types, ranges, lengths, required
// fields, unknown body properties and unknown query parameters.
//
// Two Ajv instances: query and path values arrive as text and are coerced to
// the contract's types; JSON bodies and responses are checked strictly.

import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

const DOC_ID = 'openapi.json';

/** Rewrites local refs (#/components/...) so they resolve inside the registered document. */
function qualifyRefs(value) {
  if (Array.isArray(value)) return value.map(qualifyRefs);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [
      key,
      key === '$ref' && typeof inner === 'string' && inner.startsWith('#/') ? `${DOC_ID}${inner}` : qualifyRefs(inner),
    ]));
  }
  return value;
}

function newAjv(options) {
  // strict: false because OpenAPI adds keywords such as `example` to schemas.
  const ajv = new Ajv2020({ allErrors: true, strict: false, ...options });
  addFormats(ajv);
  return ajv;
}

const LABELS = { title: 'Title', composerName: 'Composer name', catalogueNumber: 'Catalogue number', pageUrl: 'Page URL' };

/** Ajv error -> contract FieldError ({ location, field, code, message }). */
function toFieldError(error, location) {
  const name = (field) => (location === 'body' ? `/${field}` : field);
  const label = (field) => (location === 'body' ? LABELS[field] ?? field : field);
  const path = error.instancePath.replace(/^\//, '');
  switch (error.keyword) {
    case 'required':
      return { location, field: name(error.params.missingProperty), code: 'required', message: `${label(error.params.missingProperty)} is required.` };
    case 'additionalProperties':
      return location === 'query'
        ? { location, field: error.params.additionalProperty, code: 'unknown_parameter', message: `${error.params.additionalProperty} is not a parameter of this operation.` }
        : { location, field: name(error.params.additionalProperty), code: 'unknown_field', message: `${error.params.additionalProperty} is not a known field.` };
    case 'maxLength':
      return { location, field: name(path), code: 'too_long', message: `${label(path)} must be at most ${error.params.limit} characters.` };
    case 'minLength':
      return { location, field: name(path), code: 'blank', message: `${label(path)} must contain at least one non-space character.` };
    case 'minimum':
    case 'maximum':
      return { location, field: name(path), code: 'out_of_range', message: `${label(path)} must be ${error.keyword === 'minimum' ? 'at least' : 'at most'} ${error.params.limit}.` };
    case 'type':
      return { location, field: name(path || 'body'), code: 'invalid_type', message: `${label(path || 'body')} must be ${error.params.type.replace(',', ' or ')}.` };
    case 'enum':
      return { location, field: name(path), code: 'invalid_value', message: `${label(path)} must be one of: ${error.params.allowedValues.join(', ')}.` };
    case 'pattern':
      if (error.params.pattern === '\\S') {
        return { location, field: name(path), code: 'blank', message: `${label(path)} must contain at least one non-space character.` };
      }
      return { location, field: name(path), code: 'invalid_format', message: `${label(path)} has an invalid format.` };
    default:
      return { location, field: name(path || 'body'), code: 'invalid_format', message: `${label(path || 'body')} has an invalid format.` };
  }
}

/** Keeps one error per field (Ajv may report several keywords for the same value). */
function uniqueByField(errors) {
  const seen = new Set();
  return errors.filter((error) => (seen.has(error.field) ? false : (seen.add(error.field), true)));
}

/**
 * Loads openapi.yaml and compiles the validators the web adapter needs.
 * @param {URL} contractUrl
 */
export async function loadContract(contractUrl) {
  const doc = qualifyRefs(parse(await readFile(contractUrl, 'utf8')));
  const params = doc.components.parameters;

  const strictAjv = newAjv({});
  const coercingAjv = newAjv({ coerceTypes: true });
  for (const ajv of [strictAjv, coercingAjv]) ajv.addSchema({ $id: DOC_ID, components: doc.components });

  const schemaRef = (name) => ({ $ref: `${DOC_ID}#/components/schemas/${name}` });

  /** An object schema for an operation's query parameters; unknown parameters are rejected. */
  function querySchema(paramNames) {
    const properties = Object.fromEntries(paramNames.map((key) => [params[key].name, params[key].schema]));
    return { type: 'object', properties, additionalProperties: false };
  }

  const queryValidators = {
    listWorks: coercingAjv.compile(querySchema(['Query', 'ComposerFilter', 'HasCatalogueNumber', 'SourceFilter', 'Sort', 'Limit', 'Offset'])),
    none: coercingAjv.compile(querySchema([])),
  };
  const workIdValidator = coercingAjv.compile({
    type: 'object', properties: { workId: params.WorkId.schema }, required: ['workId'],
  });
  const idempotencyKeyValidator = strictAjv.compile(params.IdempotencyKey.schema);
  const createWorkValidator = strictAjv.compile(schemaRef('CreateWorkRequest'));
  const responseValidators = new Map();

  const run = (validator, value, location) => (validator(value) ? [] : uniqueByField(validator.errors.map((e) => toFieldError(e, location))));

  return {
    /** Validates and coerces a query object in place. @returns FieldError[] */
    validateQuery(operation, query) {
      return run(queryValidators[operation], query, 'query');
    },
    /** @returns {{ errors: object[], workId: number | null }} */
    validateWorkId(raw) {
      const holder = { workId: raw };
      // The contract's Id is an integer; reject forms like "3.0" or "+3" that coercion would accept.
      if (!/^\d+$/.test(raw)) {
        return { errors: [{ location: 'path', field: 'workId', code: 'invalid_type', message: 'workId must be a positive integer.' }], workId: null };
      }
      const errors = run(workIdValidator, holder, 'path').map((e) => ({ ...e, field: 'workId' }));
      return { errors, workId: errors.length ? null : holder.workId };
    },
    /** @returns FieldError[] */
    validateIdempotencyKey(value) {
      return idempotencyKeyValidator(value)
        ? []
        : [{ location: 'header', field: 'Idempotency-Key', code: 'invalid_format', message: 'Idempotency-Key must be 1-255 visible ASCII characters.' }];
    },
    /** @returns FieldError[] */
    validateCreateWork(body) {
      return run(createWorkValidator, body, 'body');
    },
    /** For tests: validates a response body against a component schema. @returns {string[]} Ajv messages */
    validateResponse(schemaName, body) {
      if (!responseValidators.has(schemaName)) responseValidators.set(schemaName, strictAjv.compile(schemaRef(schemaName)));
      const validator = responseValidators.get(schemaName);
      return validator(body) ? [] : validator.errors.map((e) => `${e.instancePath} ${e.message}`);
    },
  };
}
