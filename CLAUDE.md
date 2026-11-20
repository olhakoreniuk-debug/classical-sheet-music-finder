# Classical Sheet Music Finder

Imports classical work metadata from the IMSLP API into PostgreSQL (Docker). Goal: a searchable catalogue of all IMSLP works.

## Stack
- Node.js 24.17.0 via mise (`.mise.toml`). Plain JavaScript, ES modules. No framework, no ORM.
- Only runtime dependency: `pg`. Tests: built-in `node:test`.
- PostgreSQL in Docker via `docker-compose.yml`.

## Commands
- Always run Node/npm through mise: `mise exec -- node ...`, `mise exec -- npm ...`
  (plain `node` on this machine may resolve to a different, non-mise install).
- Tests: `mise exec -- npm test`

## Rules
- Work step by step; commit before each task; one task per session.
- Public repo: never commit `.env`, passwords or keys. Only `.env.example` with placeholders.
- Verify a package exists and is legitimate before installing it.
- Do not invent API endpoints or fields; use only the verified facts below.
- Never run the full import (`--all`) without the owner's explicit approval.

## IMSLP API (verified with live requests, 2026-11-20)
- Docs: https://imslp.org/wiki/IMSLP:API
- Works: `https://imslp.org/imslpscripts/API.ISCR.php?account=worklist/disclaimer=accepted/sort=id/type=2/start=<N>/limit=<N>/retformat=json`
- Parameters are slash-separated. `disclaimer=accepted` is required. Only `sort=id` is valid. `limit` is undocumented, max 1000.
- Response: object keyed `"0".."n"` plus `metadata` (`start`, `limit`, `moreresultsavailable`, `timestamp` in Unix seconds).
- Work fields: `id`, `type`, `parent`, `intvals.composer`, `intvals.worktitle`, `intvals.icatno` (may be missing or empty), `intvals.pageid` (may be missing), `permlink`. All values are strings.
- Errors return HTTP 200 with a JSON string body. `Content-Type` is `text/plain`.
- About 269,000 works. robots.txt: `Crawl-delay: 2`.
