# Live demo: Classical Sheet Music Finder (Week 1)

A short (about 10 minutes), reproducible demonstration of the IMSLP import
pipeline. All commands are for **Windows PowerShell**, run from the project
folder. Background on every feature shown here is in the [README](../README.md).

The demo has two variants. Choose the one that matches the computer:

| | **A. Existing computer** (default) | **B. New computer** |
|---|---|---|
| Database | already contains 10 works, 10 composers and 2 successful import runs | empty |
| IMSLP requests | **none** in the default demo | 2 (one per import, 10 records each) |
| Go to | [Part A](#part-a-demo-on-the-existing-computer-default) | [Part B](#part-b-demo-on-a-new-computer-empty-database) |

---

## Before the demo (both variants)

1. Start **Docker Desktop** and wait until the engine is running.
2. Open PowerShell in the project folder.
3. **Do not open `.env` on screen.** It contains the database password.
4. Check the tools:

   ```powershell
   mise exec -- node --version      # expected: v24.17.0
   docker compose up -d             # starts the database if it is not running yet
   docker compose ps                # STATUS must show "(healthy)"
   ```

---

## Part A: Demo on the existing computer (default)

Starting point: the Docker volume already holds the results of two earlier
imports of the same 10 IMSLP works. **Steps A1-A5 make no IMSLP requests and do
not change the imported data.**

### A1. The code is tested (about 1 minute)

```powershell
mise exec -- npm test
mise exec -- npm run test:db
```

Expected: the offline suite reports **108 tests passing** and the PostgreSQL
integration suite reports **30 tests passing**, with `fail 0` in both.

What to say:

- The offline tests cover the API client (with a fake HTTP layer), the parser,
  the importer loop and the repository's input checks. No network, no database.
- The integration tests run against the real PostgreSQL container, but in a
  temporary schema that is dropped afterwards. They check afterwards that the
  real tables were not touched.

### A2. The data that has been imported (about 2 minutes)

```powershell
mise exec -- npm run verify:import
```

This runs read-only checks (inside a `READ ONLY` transaction). Point out:

| Check | Expected on this computer |
|---|---|
| import runs | run **1** and run **2**, both `succeeded`, offsets `0 -> 10`, `works_fetched` 10 |
| `works_upserted` | **10** for run 1 (first import), **0** for run 2 (repeat import changed nothing) |
| works / distinct_permlinks | **10 / 10**: no duplicates |
| composers / orphans | **10 / 0** |
| no_composer / no_run | **0 / 0** |
| works per import run | all 10 works belong to run **1**: run 2 did not rewrite them |
| fingerprint | an MD5 hash of all work rows; note its value for step A5 |

**Idempotency is visible here without a new request:** run 2 imported the same
10 records as run 1 and changed nothing (`works_upserted = 0`, all works still
belong to run 1).

### A3. Look at the data with SQL (about 3 minutes)

Open `psql` inside the container (the single quotes are needed; the password is
never typed or shown):

```powershell
docker compose exec db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB'
```

Then paste these queries one at a time:

```sql
\dt

SELECT (SELECT count(*) FROM composers)   AS composers,
       (SELECT count(*) FROM works)       AS works,
       (SELECT count(*) FROM import_runs) AS import_runs;

SELECT c.name AS composer, count(w.id) AS works
FROM composers c
LEFT JOIN works w ON w.composer_id = c.id
GROUP BY c.name
ORDER BY c.name;

SELECT c.name AS composer, w.title, w.catalogue_number, w.imslp_page_id
FROM works w
LEFT JOIN composers c ON c.id = w.composer_id
ORDER BY w.imslp_id;

SELECT id, status, start_offset, next_offset, works_fetched, works_upserted,
       started_at, finished_at, error_message
FROM import_runs
ORDER BY id;

SELECT w.title, w.last_import_run_id AS run, w.created_at, w.updated_at
FROM works w
ORDER BY w.last_import_run_id, w.title;
```

Expected: 10 composers with 1 work each, 10 works, 2 import runs. Composer
names appear exactly as IMSLP writes them (e.g. `Ferrari, Carlotta`), and some
works have a catalogue number (e.g. `ICF 1237`) while others have none (`NULL`).
`created_at` and `updated_at` of the works are from run 1. Quit with `\q`.

### A4. How it stays safe (about 3 minutes, talk + code)

Show the importer's options without running an import:

```powershell
mise exec -- npm run import -- --help
```

Then explain, opening the files if useful:

| Topic | Where | Key point |
|---|---|---|
| Rate limiting | `src/adapters/imslp/imslpClient.js` | at least 2 s between requests (IMSLP `Crawl-delay: 2`), including retries |
| Error handling | `src/adapters/imslp/imslpClient.js` | timeout, retries with backoff for network errors / 429 / 5xx, IMSLP errors that arrive as HTTP 200 |
| Bad records | `src/adapters/imslp/parser.js` | skipped with a reason; the rest of the page is still imported |
| Transactions | `src/adapters/postgres/repository.js` (`savePage`) | one page = one transaction, including the progress checkpoint |
| Resumption | `src/core/importCatalog.js`, `import_runs.next_offset` | `--resume` continues a failed or interrupted run from the saved offset |
| One importer at a time | `src/adapters/postgres/repository.js` (`acquireImporterLock`) | PostgreSQL advisory lock |
| No full import by accident | `src/core/importCatalog.js` | default 10 records, maximum 5,000 per run, no `--all` |

### A5. Confirm nothing changed

```powershell
mise exec -- npm run verify:import
```

Expected: exactly the same output as in A2, including the same fingerprint.

---

## Optional: live repeat import (idempotency, 1 IMSLP request)

Run this only if a live network demonstration is wanted. It makes **one** request
to IMSLP for the **same 10 records** (offset 0, limit 10) that are already
stored. It never fetches new works.

```powershell
mise exec -- npm run verify:import          # note the fingerprint (skip if done in A2)
mise exec -- npm run import
mise exec -- npm run verify:import
```

Expected import output (about 2-5 seconds; the importer first waits 2 s
because of the crawl delay):

```
Importing up to 10 records, page size 10.
Started import run 3 at offset 0.
Page at offset 0: fetched 10, valid 10 (inserted 0, updated 0, unchanged 10), skipped 0

Import run 3: succeeded (limit reached)
  offsets:  0 -> 10
  fetched:  10 raw records in 1 page(s)
  works:    0 inserted, 0 updated, 10 unchanged
  skipped:  0
```

**Expected database changes:**

| Table | Change |
|---|---|
| `import_runs` | **one new row** (run 3): `succeeded`, offsets `0 -> 10`, `works_fetched` 10, `works_upserted` 0 |
| `works` | **no change**: still 10 rows; same `updated_at`, `last_import_run_id` still 1, **same fingerprint** |
| `composers` | **no change**: still 10 rows |

The run number is one higher than the last existing run (3 if runs 1 and 2
exist). The new `import_runs` row is permanent; it is the record that the
demonstration happened.

**If the output differs:**

- `updated` is greater than 0: IMSLP has edited one of those works since the
  first import. The importer correctly stored the new values. The fingerprint
  then changes and those works move to the new run. Still no duplicates.
- `Import run N is failed ...`: the latest run did not finish. Use
  `mise exec -- npm run import -- --resume`.
- `Import failed: ...` (exit code 1), for example a network error: the run is
  marked `failed` and nothing half-written is stored. Show it with the
  `import_runs` query, then continue with `--resume`.

---

## Part B: Demo on a new computer (empty database)

Do the [first-time setup](../README.md#first-time-setup) first (`mise install`,
`npm ci`, create `.env` with your own password). Then:

```powershell
docker compose up -d
docker compose ps                            # wait for "(healthy)"; the tables are created now
mise exec -- npm test
mise exec -- npm run test:db
mise exec -- npm run verify:import           # import runs: (no rows); 0 works, 0 composers

mise exec -- npm run import                  # IMSLP request 1: first import of 10 works
mise exec -- npm run verify:import           # 1 run, 10 works; note the fingerprint

mise exec -- npm run import                  # IMSLP request 2: same 10 works again
mise exec -- npm run verify:import           # 2 runs, still 10 works, same fingerprint
```

Expected:

- First import: `10 inserted, 0 updated, 0 unchanged`.
- Second import: `0 inserted, 0 updated, 10 unchanged`, and the fingerprint is
  unchanged.
- The exact works and composers are whatever IMSLP currently lists at offsets
  0-9 (sorted by IMSLP id), so they may differ from the ones on the original
  computer.

Then continue with steps A3-A5.

---

## Key points to say

- The database contents live in a Docker volume, **not in Git**. Cloning the
  repository gives you the code and an empty database.
- Only a 10-work sample has been imported. The full catalogue (about 269,000
  works), search, a user interface and voice-category classification are
  **future work**. See [Limitations and future work](../README.md#limitations-and-future-work).
