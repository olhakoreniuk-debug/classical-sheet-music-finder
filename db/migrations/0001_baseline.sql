-- 0001 baseline: the schema of the Week 1 IMSLP importer (formerly db/schema.sql).
--
-- On a new, empty database `npm run migrate` runs this file.
-- On the existing database, which already has these tables and data, the
-- runner does NOT run it: it checks that the tables and columns exist and
-- records 0001 as applied ("baselined"). See ADR-0006.
--
-- Never edit this file after it has been applied: the runner stores its
-- checksum and refuses to continue if it changes. Add a new migration instead.
--
-- Idempotent imports rely on two natural keys:
--   composers.name  UNIQUE  -> INSERT ... ON CONFLICT (name)
--   works.permlink  UNIQUE  -> INSERT ... ON CONFLICT (permlink)

-- One row per import run: status, progress and resume point.
CREATE TABLE import_runs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'succeeded', 'failed')),
    start_offset    INTEGER NOT NULL DEFAULT 0 CHECK (start_offset >= 0),
    next_offset     INTEGER CHECK (next_offset >= 0),
    works_fetched   INTEGER NOT NULL DEFAULT 0,
    works_upserted  INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT
);

-- Composer names exactly as IMSLP returns them in intvals.composer.
CREATE TABLE composers (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per IMSLP work (API type=2).
CREATE TABLE works (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    permlink            TEXT NOT NULL UNIQUE,              -- permlink
    imslp_id            TEXT NOT NULL,                     -- id
    title               TEXT NOT NULL,                     -- intvals.worktitle
    composer_id         BIGINT REFERENCES composers(id),   -- NULL if composer missing/unusual
    catalogue_number    TEXT,                              -- intvals.icatno (empty -> NULL)
    imslp_page_id       BIGINT,                            -- intvals.pageid (missing/invalid -> NULL)
    parent              TEXT,                              -- parent
    last_import_run_id  BIGINT REFERENCES import_runs(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()  -- set by the upsert
);

-- PostgreSQL does not index foreign key columns automatically.
CREATE INDEX works_composer_id_idx ON works (composer_id);
