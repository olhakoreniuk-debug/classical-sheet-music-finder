// RFC 9457 Problem Details (openapi.yaml: Problem). Every error response uses
// this shape and the media type application/problem+json.

const BASE = 'https://classical-sheet-music-finder.local/problems/';

/** An error carrying a ready Problem; thrown by middleware and mapped by the error handler. */
export class HttpProblem extends Error {
  constructor(status, slug, title, detail, errors) {
    super(detail ?? title);
    this.name = 'HttpProblem';
    this.status = status;
    this.type = slug === null ? 'about:blank' : `${BASE}${slug}`;
    this.title = title;
    this.detail = detail;
    this.errors = errors;
  }
}

export const problems = {
  invalidParameter: (errors) =>
    new HttpProblem(400, 'invalid-parameter', 'Invalid request parameter', 'One or more parameters are invalid.', errors),
  malformed: (detail, errors) => new HttpProblem(400, 'malformed-request', 'Malformed request', detail, errors),
  writesDisabled: () => new HttpProblem(403, 'writes-disabled', 'Writes are disabled', 'This server does not accept changes.'),
  originNotAllowed: () =>
    new HttpProblem(403, 'origin-not-allowed', 'Request origin not allowed', 'Changes are accepted only from the same origin as the server.'),
  notFound: (detail) => new HttpProblem(404, 'not-found', 'Not found', detail),
  workNotFound: (workId) => new HttpProblem(404, 'not-found', 'Work not found', `There is no work with id ${workId}.`),
  methodNotAllowed: () => new HttpProblem(405, null, 'Method Not Allowed', 'This method is not supported for this resource.'),
  duplicateWork: (workId) => new HttpProblem(409, 'duplicate-work', 'Work already exists', `Work ${workId} already has this pageUrl.`),
  idempotencyInProgress: () =>
    new HttpProblem(409, 'idempotency-in-progress', 'Request still in progress', 'A request with this Idempotency-Key is still being processed.'),
  payloadTooLarge: () => new HttpProblem(413, 'payload-too-large', 'Request body too large', 'The request body must not exceed 16 KB.'),
  unsupportedMediaType: () =>
    new HttpProblem(415, 'unsupported-media-type', 'Unsupported media type', 'Send the request body as application/json.'),
  validation: (errors) =>
    new HttpProblem(422, 'validation', 'Validation failed', `${errors.length} ${errors.length === 1 ? 'field is' : 'fields are'} invalid.`, errors),
  internal: () => new HttpProblem(500, null, 'Internal Server Error'),
};

/** Writes a problem response. `instance` is the request path. */
export function sendProblem(res, problem, instance) {
  const body = { type: problem.type, title: problem.title, status: problem.status };
  if (problem.detail) body.detail = problem.detail;
  body.instance = instance;
  if (problem.errors?.length) body.errors = problem.errors;
  res.status(problem.status).type('application/problem+json').send(JSON.stringify(body));
}
