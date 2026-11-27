# ADR-0002: Manual work creation and source-specific identity

- **Status:** Accepted
- **Date:** 2026-11-27
- **Changes:** refines open decision D-5 of architecture v2 (see below).

## Context

Assignment 2 requires one write endpoint with validation. The catalogue is
filled by importers (IMSLP today, OpenScore Lieder later). Imported records
must stay faithful to their source and must be re-importable without
duplicates.

Today `works.permlink` is globally unique and the IMSLP importer upserts with
`ON CONFLICT (permlink)`. If a manually created work used an IMSLP page URL,
a later IMSLP import would **update that manual row** and take it over. This
must be impossible.

## Decision

1. **The write endpoint is `POST /works`**, which adds a work to the source
   `manual`. Imported works cannot be created or changed through the API.
   The client cannot choose the source.

2. **Every work belongs to exactly one source and is identified within it**
   (migration 0002):
   - table `sources` (`code` unique, `name`, `kind` external/manual,
     `homepage_url`, `attribution`, `metadata_licence`), seeded with `imslp`
     and `manual`; later `pdf_policy` is added by the PDF stages;
   - `works.source_id` (NOT NULL, foreign key; existing works back-filled
     with `imslp`);
   - `works.source_work_id` (NOT NULL): IMSLP uses its permlink; manual works
     get a server-generated UUID;
   - **`UNIQUE (source_id, source_work_id)`** replaces the global
     `UNIQUE (permlink)`;
   - `permlink` (the page URL) and `imslp_id` become nullable.

3. **Importers can only ever write their own source's rows.** The IMSLP
   upsert uses `ON CONFLICT (source_id, source_work_id)` with its own
   `source_id`. A conflict with a manual row is structurally impossible: an
   import of the same page URL inserts a separate IMSLP row and never
   updates the manual one.

4. **Duplicate page URLs:** `POST /works` returns `409` when any work, from
   any source, already has the same page URL. URLs are compared after
   trimming and percent-decoding, so the encoded and unencoded forms of an
   IMSLP permlink are recognised as the same. This is an application rule,
   checked in the core use case; the database guarantees identity per
   source. Linking works that represent the same piece across sources is
   handled later by duplicate detection (`work_links`).

5. **Validation layers** (details in ADR-0004):
   - the HTTP adapter validates the request against `openapi.yaml` (types,
     lengths, required and unknown fields) and returns `400`/`422`;
   - the core use case applies domain rules (trimming, blank values, URL
     normalisation, duplicate check, composer reuse) and returns domain
     errors that map to `409`/`422`;
   - database constraints are the last line of defence.

6. **Composers:** an existing composer with exactly the submitted name is
   reused; otherwise a new composer is created.

7. **Attribution:** a work's `attribution` comes from its source's
   `attribution`; manual works have none.

## Relationship to architecture v2

v2 decision D-5 recommended keeping `works.permlink` unique while making it
optional. This ADR instead makes identity unique **per source** and drops the
global uniqueness of `permlink`, because a globally unique page URL would let
one source's import collide with another source's records. All other T4
schema plans (sources, `source_id`, `source_work_id`) are unchanged.

## Consequences

- Imports can never overwrite manual works; this is enforced by the database
  and covered by a test (manual work with an IMSLP URL, then an IMSLP
  import: both rows exist, the manual row is unchanged).
- The same piece can exist once per source; cross-source linking is a later
  feature.
- The importer needs a small change in migration step 0002: it writes
  `source_id` and `source_work_id`.
- Manual data may be of uneven quality; it is clearly labelled with its
  source in the API and the UI.

## Alternatives considered

- **Editing imported works (`PATCH /works/{id}`):** the next import would
  overwrite the edits. Rejected.
- **Keeping `UNIQUE (permlink)` globally:** causes the takeover problem
  described above. Rejected.
- **A non-catalogue write endpoint (e.g. favourites):** would need user
  accounts first. Rejected for Assignment 2.
