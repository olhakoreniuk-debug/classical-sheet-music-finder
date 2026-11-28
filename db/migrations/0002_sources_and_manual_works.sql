-- 0002: sources and source-specific work identity (ADR-0002).
--
-- * sources: one row per source of works, seeded with 'imslp' and 'manual'
--   (values as in openapi.yaml, SourceListExample).
-- * works.source_id + works.source_work_id identify a work within its source;
--   UNIQUE (source_id, source_work_id) replaces the global UNIQUE (permlink),
--   so an import can never update another source's row (e.g. a manual work).
-- * works.permlink (the page URL) and works.imslp_id become optional.
-- * works.page_url_key: the page URL trimmed and percent-decoded, used by the
--   application to reject duplicate page URLs across sources (ADR-0002 §4).
-- * import_runs.source_id: runs are tracked per source.
--
-- Existing rows are kept with their ids: every existing work and run is an
-- IMSLP one. The runner executes this file in one transaction, so any failed
-- check below leaves the database unchanged.

CREATE TABLE sources (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code              TEXT NOT NULL UNIQUE
                      CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(code) <= 50),
    name              TEXT NOT NULL CHECK (btrim(name) <> ''),
    kind              TEXT NOT NULL CHECK (kind IN ('external', 'manual')),
    homepage_url      TEXT,
    attribution       TEXT CHECK (attribution IS NULL OR btrim(attribution) <> ''),
    metadata_licence  TEXT CHECK (metadata_licence IS NULL OR btrim(metadata_licence) <> ''),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sources (code, name, kind, homepage_url, attribution, metadata_licence) VALUES
    ('imslp', 'IMSLP', 'external', 'https://imslp.org',
     'Data from IMSLP, the Petrucci Music Library (imslp.org).', NULL),
    ('manual', 'Added manually', 'manual', NULL, NULL, NULL);

-- ---------- works ----------

ALTER TABLE works
    ADD COLUMN source_id      BIGINT REFERENCES sources(id),
    ADD COLUMN source_work_id TEXT,
    ADD COLUMN page_url_key   TEXT;

-- The key of an existing page URL equals the URL itself only if it has no
-- surrounding spaces and no percent-escapes. Stop instead of guessing.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM works WHERE permlink <> btrim(permlink) OR permlink LIKE '%\%%') THEN
        RAISE EXCEPTION 'works.permlink contains spaces or percent-escapes; page_url_key cannot be back-filled in SQL';
    END IF;
END $$;

UPDATE works
SET source_id      = (SELECT id FROM sources WHERE code = 'imslp'),
    source_work_id = permlink,
    page_url_key   = permlink;

ALTER TABLE works
    ALTER COLUMN source_id      SET NOT NULL,
    ALTER COLUMN source_work_id SET NOT NULL,
    ADD CONSTRAINT works_source_work_id_check CHECK (btrim(source_work_id) <> ''),
    ADD CONSTRAINT works_source_work_key UNIQUE (source_id, source_work_id);

ALTER TABLE works DROP CONSTRAINT works_permlink_key;

ALTER TABLE works
    ALTER COLUMN permlink DROP NOT NULL,
    ALTER COLUMN imslp_id DROP NOT NULL;

CREATE INDEX works_page_url_key_idx ON works (page_url_key);

-- ---------- import runs ----------

ALTER TABLE import_runs ADD COLUMN source_id BIGINT REFERENCES sources(id);
UPDATE import_runs SET source_id = (SELECT id FROM sources WHERE code = 'imslp');
ALTER TABLE import_runs ALTER COLUMN source_id SET NOT NULL;
CREATE INDEX import_runs_source_id_idx ON import_runs (source_id, id);
