# ADR-0001: Implementation sequence for Assignment 2

- **Status:** Accepted (sequence approved by the project owner). The roadmap
  adjustment below is **proposed** and has not yet been applied to the
  roadmap documents.
- **Date:** 2026-11-27

## Context

Assignment 2 requires an OpenAPI contract, a REST API and a React frontend
that show real stored data. The approved architecture v2 planned a web layer
only after stages T1-T8, which mostly concern multiple sources and the PDF
pipeline.

Analysis of T1-T4 against Assignment 2:

- **T1** (migration runner) is required: every database change for the API
  must be a versioned migration, and API database tests build their schema
  from the migrations.
- **T2** (decouple the core) is required: the API is a second driving
  adapter next to the import command. Without `src/core/` and a repository
  created with its pool, the API would be wired into today's coupled
  structure and refactored later.
- **T3** (neutral work model, `CatalogSource`) concerns importers, not the
  API, and can follow later.
- **T4** is needed only in part: the API needs `sources`, a source per work,
  source-specific identifiers and the `manual` source (see ADR-0002).
  Per-source import runs can follow later.
- **T5-T8** (PDF pipeline) are unrelated to Assignment 2.

## Decision

Implement in this order, each step on its own local feature branch, reviewed
and approved before it is committed:

1. **Contract** - `openapi.yaml` revised and linted; ADR-0001 to ADR-0006.
2. **T1** - migration runner and `0001` baseline, as planned, including
   decision D-4 (ADR-0006).
3. **T2** - decouple the core, as planned (no behaviour change).
4. **Migration 0002** - sources and manual works (ADR-0002). The importer
   changes only as far as needed to write source-specific identifiers.
5. **REST API** - Express adapter (ADR-0004): read endpoints first, then
   `POST /works` with the security model of ADR-0003.
6. **Frontend** - React, TypeScript and Vite (ADR-0005), built from
   `openapi.yaml` with generated types:
   catalogue, detail view, form, loading, empty and error states.
7. **Optional** - idempotent `POST /works`.

After Assignment 2: the remainder of T3 and T4, the second provider
(OpenScore Lieder), then T5-T8.

## Proposed roadmap adjustment (not yet applied)

| Order | Stage | Change compared with roadmap v2 |
|---|---|---|
| 1 | T1 Migration runner and 0001 baseline | unchanged |
| 2 | T2 Decouple the core | unchanged |
| 3 | **T4a** Migration 0002: sources, source-specific identity, manual source | new split of T4 (schema part) |
| 4 | **A1** REST API read endpoints | new |
| 5 | **A2** REST API `POST /works` | new |
| 6 | **A3** React + TypeScript frontend | new |
| 7 | **A4** Idempotent writes (optional) | new |
| 8 | T3 Neutral model, `CatalogSource`, `ImslpSource` | moved after Assignment 2 |
| 9 | **T4b** Per-source import runs and resume | remainder of T4 |
| 10 | Second provider: OpenScore Lieder adapter (works metadata) | brought forward from T8 (metadata only) |
| 11 | T5-T8 Licences, score files, storage, PDF pipeline | unchanged, after the above |

The roadmap documents (`docs/architecture/ARCHITECTURE.md` section 20 and
`Implementation_Roadmap.docx`) will be updated to this table only after the
owner approves the update.

## Consequences

- A working MVP with real data is reached without the PDF pipeline.
- No work is done twice: T2 creates the structure the API needs.
- The importer is touched minimally before T3; IMSLP imports keep working.
- Assignment 2 delivery depends on T1 and T2 being completed first.

## Alternatives considered

- **API on today's schema and structure first, refactor later:** faster to a
  first response, but the API would be built twice and its database changes
  would bypass migrations. Rejected.
- **All of T1-T4 before the API:** T3 and per-source runs add no value to
  Assignment 2. Rejected as unnecessary delay.
