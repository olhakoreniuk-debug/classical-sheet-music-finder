-- Schema for the Classical Sheet Music Finder.
--
-- Safe to run more than once: every statement uses IF NOT EXISTS.
-- Note: IF NOT EXISTS does NOT migrate existing tables. If a table already
-- exists, changes made here are silently skipped. Schema migrations will be
-- handled separately later.
--
-- Idempotent imports rely on two natural keys:
--   composers.name  UNIQUE  -> INSERT ... ON CONFLICT (name)
--   works.permlink  UNIQUE  -> INSERT ... ON CONFLICT (permlink)

-- One row per import run: status, progress and resume point.
CREATE TABLE IF NOT EXISTS import_runs (
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
CREATE TABLE IF NOT EXISTS composers (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per IMSLP work (API type=2).
CREATE TABLE IF NOT EXISTS works (
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
CREATE INDEX IF NOT EXISTS works_composer_id_idx ON works (composer_id);
