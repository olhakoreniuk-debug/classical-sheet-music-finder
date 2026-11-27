# ADR-0003: Security model for local development

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

The API will have one write operation (`POST /works`) and no user
authentication yet. It runs on the owner's laptop. A local server is still
reachable by other software on the same machine and, through the owner's
browser, by any website the owner visits (cross-site request forgery against
`localhost`).

## Decision

The API is a **local development** service with these protections:

1. **Loopback only:** the server listens on `127.0.0.1` by default
   (`API_HOST`), like PostgreSQL in `docker-compose.yml`.
2. **Writes disabled by default:** `POST /works` returns `403`
   (`writes-disabled`) unless `.env` sets `API_WRITES_ENABLED=true`.
3. **Same-origin writes only:** write requests must carry an `Origin` header
   that matches an allowed origin (the API's own origin and, in development,
   the Vite dev server), otherwise `403`. The server sends **no CORS
   headers**, so browsers block cross-origin calls.
4. **JSON only:** write requests must use `Content-Type: application/json`,
   otherwise `415`. Browsers cannot send this cross-site without a CORS
   preflight, which the server does not approve.
5. **Size limit:** request bodies larger than 16 KB are rejected with `413`.
6. **No information leaks:** `500` responses are generic Problem Details; no
   stack traces, SQL or configuration values in responses or client logs.
7. **Safe output:** the frontend renders all text as text (React escaping);
   `dangerouslySetInnerHTML` is not used. IMSLP titles contain quotation
   marks and other special characters.
8. **Basic response headers:** `X-Content-Type-Options: nosniff` on all
   responses; a Content Security Policy for the frontend when it is served
   by Express.
9. **Secrets:** configuration only in `.env` (ignored by git); placeholders
   in `.env.example`.

**Public deployment is out of scope.** Before the API is reachable from
another machine, a new ADR must add at least: user authentication and
authorisation for writes, TLS, rate limiting, CSRF protection suited to the
chosen authentication, and audit logging of writes.

## Consequences

- An accidental write is impossible unless writes are explicitly enabled.
- Other websites cannot create works through the owner's browser.
- The protections live in the HTTP adapter (middleware); the core is
  unaffected and can be reused with real authentication later.
- Each protection is covered by an API test (`403` disabled, `403` wrong
  origin, `413`, `415`).

## Alternatives considered

- **A shared secret token in the frontend:** visible to anyone using the
  browser, so it adds no real protection locally. Rejected.
- **Full authentication now:** not required by Assignment 2 and premature
  without a public deployment. Deferred to a future ADR.
