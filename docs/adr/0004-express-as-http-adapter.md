# ADR-0004: Express.js as the HTTP adapter

- **Status:** Accepted
- **Date:** 2026-11-27
- **Changes:** replaces the earlier recommendation of the built-in
  `node:http` module. Amends the project rules in `CLAUDE.md` ("only runtime
  dependency: `pg`", "no framework"); see "Required updates to `CLAUDE.md`".
- **Extends architecture v2:** adds the use cases and ports listed below.

## Context

The REST API needs routing, JSON body handling, middleware for the security
rules of ADR-0003, request validation against `openapi.yaml` and consistent
Problem Details errors. The project follows Ports and Adapters (architecture
v2): the core must not depend on any HTTP library.

In architecture v2, **driving adapters** (which start work) live in
`scripts/`, `src/cli/` and `src/web/`; **driven adapters** (which the core
calls through ports) live in `src/adapters/`. The REST API is a driving
adapter.

## Decision

Use **Express 5** as the HTTP framework, strictly as a **driving adapter**.
Express code exists only in `src/web/`.

### Structure

```text
src/web/
  createApp.js           builds the Express app from injected use cases and config
  routes/
    worksRouter.js        GET /works, GET /works/:workId, POST /works
    sourcesRouter.js      GET /sources
  middleware/
    jsonBody.js           application/json only (415), 16 KB limit (413), malformed JSON (400)
    writeGuard.js         writes enabled? same origin? (403)
    validateRequest.js    validates parameters, headers and body against openapi.yaml (400/422)
    errorHandler.js       maps errors to Problem Details; generic 500
  validation/
    contractValidator.js  compiles schemas from openapi.yaml; converts errors to FieldError
  mappers/
    workMapper.js         domain work -> API Work (camelCase, encoded pageUrl, attribution)
  problems.js             Problem Details factory
scripts/serve-api.js      composition root: config, pool, adapters, use cases, app, listen
```

### Separation of concerns

| Concern | Location | Knows about |
|---|---|---|
| HTTP routing and middleware | `src/web/` | Express, the contract, core use cases |
| Input validation (contract) | `src/web/validation/` | `openapi.yaml` |
| Business logic and domain rules | `src/core/catalog/`: `listWorks`, `getWork`, `createWork`, `listSources` | ports only |
| Database access | `src/adapters/postgres/`, implementing `WorkQueries`, `WorkCommands`, `SourceQueries` | `pg` |
| External providers | `src/adapters/<provider>/`, implementing `CatalogSource` | the provider |
| Wiring | `scripts/serve-api.js` | everything |

Route handlers stay thin: read the validated request, call one use case, map
the result. They contain no SQL and no business rules.

**New ports (extending v2):** `WorkQueries` (list and get works),
`WorkCommands` (create a manual work) and `SourceQueries` (list sources).
They are kept separate from v2's `CatalogRepository`, which serves the
importers, so each port has one reason to change (interface segregation).
v2's planned `searchCatalog` use case is realised as `listWorks`.

### Validation without duplication (DRY)

Request validation is **derived from `openapi.yaml`** at start-up (Ajv with
formats), so the contract is the single source of truth for types, ranges,
lengths, required fields, unknown body properties and unknown query
parameters. Domain rules that the contract cannot express (blank after
trimming, duplicate page URL, composer reuse) live in the core. The same
validator checks every response in the contract tests.

### Error handling

One error-handling middleware maps every error to Problem Details
(`application/problem+json`): contract violations to `400`/`422` with
`errors[]`, domain errors from the core (`WorkNotFound`, `DuplicateWork`) to
`404`/`409`, guard failures to `403`/`413`/`415`, and anything unexpected to
a generic `500` that is logged on the server but reveals nothing to the
client.

### Dependencies (runtime)

`express`, `ajv`, `ajv-formats`, `yaml` (to load `openapi.yaml`), plus the
existing `pg`. Each package is verified before installation and pinned to a
release at least two weeks old. No other middleware packages: the few
security headers and the body limit are set directly.

### Testing

- Use-case tests with fake ports (no HTTP, no database).
- API tests start the app on a random local port and call it with Node's
  built-in `fetch` (no extra test client), validating every response against
  `openapi.yaml`.
- `test/architecture.test.js` is extended: `src/core/` must not import
  `express` or `src/web/`.

## Required updates to `CLAUDE.md` (later phase)

Not applied during the contract phase. When the API is implemented:

- Stack: replace "No framework" and "Only runtime dependency: `pg`" with
  "Backend: plain JavaScript (ES modules) with Express 5 as the HTTP adapter.
  Runtime dependencies: `pg`, `express`, `ajv`, `ajv-formats`, `yaml`; any
  other dependency needs an ADR."
- Commands: add `mise exec -- npm run api` (start the API) and the API test
  command.
- Rules: "`openapi.yaml` is the single source of truth for the API; change it
  (with an ADR) before changing the implementation."

## Consequences

- Familiar, well-documented framework; Express 5 forwards errors from async
  handlers to the error handler.
- Four additional runtime dependencies, justified by routing, middleware and
  contract-driven validation.
- Swapping Express for another HTTP library later affects only `src/web/`
  and `scripts/serve-api.js`.

## Alternatives considered

- **`node:http` (built-in):** no dependencies, but more hand-written routing
  and middleware code. Not chosen by the owner.
- **Fastify:** schema-first and fast; the owner prefers Express.
- **`express-openapi-validator`:** convenient, but less control over the
  Problem Details error format and more transitive dependencies. Ajv used
  directly is smaller and explicit.
- **Hand-written validators:** would duplicate the contract (violates DRY).
