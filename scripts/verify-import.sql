-- Read-only checks after an import. Run with: mise exec -- npm run verify:import
-- (scripts/verify-import.js runs this file inside a READ ONLY transaction).
-- Each check starts with a "-- check:" line; keep this file ASCII-only.

-- check: import runs
SELECT id, status, start_offset, next_offset, works_fetched, works_upserted,
       error_message, finished_at IS NOT NULL AS finished
FROM import_runs ORDER BY id;

-- check: works total and distinct permlinks (must be equal)
SELECT count(*)::int AS works, count(DISTINCT permlink)::int AS distinct_permlinks FROM works;

-- check: composers and orphan composers without works (orphans should be 0)
SELECT count(*)::int AS composers,
       (count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM works w WHERE w.composer_id = c.id)))::int AS orphans
FROM composers c;

-- check: works without composer / without import run
SELECT (count(*) FILTER (WHERE composer_id IS NULL))::int AS no_composer,
       (count(*) FILTER (WHERE last_import_run_id IS NULL))::int AS no_run
FROM works;

-- check: works per import run (last run that inserted or changed them)
SELECT last_import_run_id, count(*)::int AS works FROM works
GROUP BY last_import_run_id ORDER BY last_import_run_id;

-- check: imported works
SELECT w.id, c.name AS composer, w.title, w.catalogue_number, w.imslp_page_id,
       w.last_import_run_id AS run
FROM works w LEFT JOIN composers c ON c.id = w.composer_id
ORDER BY w.imslp_id;

-- check: fingerprint of all work rows (identical before and after a repeat import)
SELECT count(*)::int AS works,
       md5(coalesce(string_agg(w::text, '|' ORDER BY w.id), '')) AS works_fingerprint
FROM works w;
