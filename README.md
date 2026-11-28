# Classical Sheet Music Finder

Imports metadata about classical music works from the
[IMSLP](https://imslp.org) (International Music Score Library Project) API into
a PostgreSQL database. The long-term goal is a searchable catalogue of all IMSLP
works. This repository currently contains the **import pipeline**: the part that
fetches, cleans and safely stores the data.

> **Project status (Week 1).** The importer works end to end and has been tested
> on a sample of **10 real IMSLP works**. Search, a user interface, voice-category
> classification and a full-catalogue import are **not implemented yet**. See
> [Limitations and future work](#limitations-and-future-work).

## Contents

- [Why IMSLP](#why-imslp)
- [What surprised us in the data](#what-surprised-us-in-the-data)
- [What it does today](#what-it-does-today)
- [Architecture](#architecture)
- [Technologies](#technologies)
- [Prerequisites (Windows)](#prerequisites-windows)
- [First-time setup](#first-time-setup)
- [Starting and stopping PostgreSQL](#starting-and-stopping-postgresql)
- [Running the importer](#running-the-importer)
- [Verifying an import](#verifying-an-import)
- [Running the tests](#running-the-tests)
- [Inspecting the data with SQL](#inspecting-the-data-with-sql)
- [How the importer stays safe](#how-the-importer-stays-safe)
- [Where the data lives](#where-the-data-lives)
- [Limitations and future work](#limitations-and-future-work)
- [Data source](#data-source)

A step-by-step live demonstration script is in [docs/DEMO.md](docs/DEMO.md).
The proposed next architecture (v2, not yet implemented) and its T1–T8
implementation roadmap are in [docs/architecture/](docs/architecture/ARCHITECTURE.md).

## Why IMSLP

- **It is about classical music.** Every record describes a classical work:
  title, composer, catalogue number and a link to its IMSLP page. That is
  exactly the metadata a sheet music finder needs.
- **It has a public API.** The worklist API returns JSON over HTTPS and needs
  no API key (requests must include `disclaimer=accepted`). Documentation:
  <https://imslp.org/wiki/IMSLP:API>.
- **It is large enough to be worth browsing.** IMSLP lists about 269,000 works.
- **It supports pagination.** Works are requested in pages (`start`, `limit`)
  in a fixed sort order (`sort=id`), and each response says whether more results
  are available. That makes a resumable, page-by-page import possible.
- **It fits a structured catalogue.** Each work has a unique link to its page
  (`permlink`) and a composer name, which map naturally to `works` and
  `composers` tables with a unique key for idempotent imports.

This project stores metadata only, not scores, and respects IMSLP's
`robots.txt` crawl delay. Check IMSLP's own terms before reusing its content.

## What surprised us in the data

All of these were seen in real API responses while building the importer:

- **Parameters are separated by `/`, not `&`:**
  `API.ISCR.php?account=worklist/disclaimer=accepted/sort=id/type=2/start=0/limit=10/retformat=json`.
  `limit` is not documented; the largest value IMSLP accepts is 1000.
- **Errors can arrive as HTTP 200.** Some application errors return status 200
  with a JSON *string* as the whole body (and `Content-Type: text/plain`), so
  the client cannot trust the status code alone.
- **Works are not a JSON array.** They come as an object keyed `"0"`, `"1"`,
  ... plus a `metadata` key. The keys must be sorted numerically (`"10"` comes
  after `"9"`, not after `"1"`).
- **Catalogue numbers are often absent.** `intvals.icatno` may be missing or an
  empty string `""`; 6 of our first 10 works have none.
- **Permlinks contain literal quotation marks**, for example
  `https://imslp.org/wiki/"A"_(Ferrari,_Carlotta)`. All 10 works at the start
  of the list have titles that begin with `"`.
- **Types are mixed.** Work fields (including `id`, `type` and `pageid`) are
  strings, while `metadata.start`, `metadata.limit` and `metadata.timestamp`
  are numbers and `metadata.moreresultsavailable` is a boolean.

## What it does today

- Fetches works from the IMSLP "worklist" API, one page at a time (up to 1,000
  records per request), with timeouts, retries and a 2-second gap between requests.
- Validates and cleans each record. Invalid records are skipped and reported;
  the rest of the page is still imported.
- Stores composers and works in PostgreSQL. Each page is saved in a single
  transaction together with the import's progress.
- Records every import as a row in `import_runs`, so an interrupted or failed
  import can be resumed from where it stopped.
- Can be re-run safely: importing the same works again does not create
  duplicates and does not rewrite unchanged rows.
- Includes a read-only verification script and automated tests.

## Architecture

Ports and Adapters (see [docs/architecture](docs/architecture/ARCHITECTURE.md)): `src/core/` holds the
import use case, its ports and errors and imports nothing outside itself; `src/adapters/` hold the
IMSLP and PostgreSQL code; `src/cli/` parses options and formats output; `scripts/` wire them
together. `test/architecture.test.js` enforces these boundaries.

```
  IMSLP API (HTTPS, JSON)
          |
          v
  src/adapters/imslp/imslpClient.js   fetch one page: timeout, retries, crawl delay, error detection
          |
          v
  src/adapters/imslp/parser.js        validate and clean records (pure functions, no I/O)
          |
          v
  src/core/importCatalog.js      the loop: choose/resume a run, fetch -> parse -> save, summary
          |
          v
  src/adapters/postgres/repository.js    SQL: upsert composers and works + save progress, one transaction per page
          |
          v
  src/adapters/postgres/db.js            connection pool and transaction helper (reads credentials from .env)
          |
          v
  PostgreSQL 17 (Docker)
```

| Path | Purpose |
|---|---|
| `scripts/import.js` | Command-line entry point for the importer (`npm run import`) |
| `scripts/verify-import.js` + `scripts/verify-import.sql` | Read-only checks after an import (`npm run verify:import`) |
| `scripts/fetch-sample.js` | Fetches 10 works and prints them; writes nothing (`npm run fetch:sample`) |
| `db/migrations/` + `src/adapters/postgres/migrations.js` + `scripts/migrate.js` | Versioned schema migrations (`npm run migrate`, ADR-0006) |
| `docker-compose.yml` | The PostgreSQL container |
| `test/*.test.js` | Offline tests (no network, no database) |
| `test/db/*.test.js` | Integration tests against the real PostgreSQL container |

### Database tables

| Table | One row per | Key columns |
|---|---|---|
| `composers` | composer name, exactly as IMSLP writes it (e.g. `Ferrari, Carlotta`) | `name` (unique) |
| `works` | IMSLP work | `permlink` (unique), `imslp_id`, `title`, `composer_id`, `catalogue_number`, `imslp_page_id`, `parent`, `last_import_run_id` |
| `import_runs` | import run | `status` (`running` / `succeeded` / `failed`), `start_offset`, `next_offset`, `works_fetched`, `works_upserted`, `error_message` |

`works.permlink` and `composers.name` are unique. That is what makes repeated
imports safe: a work or composer that already exists is updated or left alone,
never duplicated.

## Technologies

- **Node.js 24.17.0** (plain JavaScript, ES modules; no framework, no ORM),
  managed with **mise** (`.mise.toml`)
- **[pg](https://www.npmjs.com/package/pg)**: the only runtime dependency
- **PostgreSQL 17** in **Docker** (`docker-compose.yml`)
- **node:test**: Node's built-in test runner (no extra test libraries)

## Prerequisites (Windows)

All commands in this README are for **Windows PowerShell** and are run from the
project folder.

1. **Git**: <https://git-scm.com/download/win>
2. **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>.
   Start it and wait until it reports that the engine is running.
3. **mise** (installs and runs the correct Node.js version): see
   <https://mise.jdx.dev/getting-started.html>. On Windows, for example:

   ```powershell
   winget install jdx.mise
   ```

   Open a new PowerShell window afterwards so `mise` is on the `PATH`.

**Always run Node and npm through mise** (`mise exec -- ...`). A plain `node`
command may find a different Node.js installation on your computer. You do not
need to install Node.js separately; mise installs version 24.17.0 for you.

Check the tools:

```powershell
git --version
docker --version
docker compose version
mise --version
```

## First-time setup

Follow this section on a **new computer with an empty database**. If the
project is already set up (Docker volume with data, `.env` present), skip to
[Running the importer](#running-the-importer) or [docs/DEMO.md](docs/DEMO.md).

```powershell
# 1. Get the code
git clone https://github.com/olhakoreniuk-debug/classical-sheet-music-finder.git
cd classical-sheet-music-finder

# 2. Install Node.js 24.17.0 (mise may first ask you to trust .mise.toml)
mise trust
mise install
mise exec -- node --version      # expected: v24.17.0

# 3. Install the dependency (pg), exactly as locked in package-lock.json
mise exec -- npm ci

# 4. Create your local settings file from the template
Copy-Item .env.example .env
notepad .env                     # set POSTGRES_PASSWORD to a password of your own
```

### Environment variables (`.env`)

`.env` holds your local settings, including the database password. It is listed
in `.gitignore` and **must never be committed**. Only `.env.example`, which
contains placeholder values, is part of the repository.

| Variable | Used by | Meaning |
|---|---|---|
| `POSTGRES_USER` | Docker + Node | Database user created on first start |
| `POSTGRES_PASSWORD` | Docker + Node | That user's password. **Choose your own; do not keep `change_me`.** |
| `POSTGRES_DB` | Docker + Node | Database name |
| `POSTGRES_HOST` | Node | Default `localhost` |
| `POSTGRES_PORT` | Docker + Node | Default `5432`. Docker publishes it on `127.0.0.1` only, so it is not reachable from your network |
| `IMSLP_BASE_URL` | Node | IMSLP API address |
| `IMPORT_PAGE_SIZE` | Node | Records per API request (1-1000) |
| `IMPORT_DELAY_MS` | Node | Minimum gap between API requests (default 2000 ms) |
| `IMPORT_TIMEOUT_MS` | Node | Timeout per API request (default 30000 ms) |
| `IMPORT_RETRIES` | Node | Retries after a failed request (default 3) |

Docker Compose reads `.env` automatically. The npm scripts load it with
`node --env-file-if-exists=.env`. Error messages name a missing variable but
never print its value.

> Docker uses `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` **only the
> first time** the database volume is created. Changing them later in `.env`
> does not change the existing database (see [Where the data lives](#where-the-data-lives)).

## Starting and stopping PostgreSQL

```powershell
docker compose up -d     # start (creates an empty database on the very first start)
docker compose ps        # wait until STATUS shows "(healthy)"
```

Then create or update the tables with the migration runner (safe to run any
time; it only applies migrations that have not run yet):

```powershell
mise exec -- npm run migrate
```

On a new database this creates `composers`, `works` and `import_runs` from
`db/migrations/0001_baseline.sql`. A database created before migrations existed
is *baselined*: its tables are checked and `0001` is recorded as applied without
running it, so no data is touched. Applied migrations are listed in the table
`schema_migrations`.

Open an interactive SQL prompt (`psql`) inside the container. The single quotes
matter: the user and database names are read from the container's own
environment, so you never type the password:

```powershell
docker compose exec db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB'
```

Type `\dt` to list the tables, `\x` to switch wide results to one-field-per-line
display, and `\q` to quit.

Stop the database:

```powershell
docker compose stop      # stop; data is kept
docker compose down      # remove the container; data is kept (the volume remains)
```

> **Warning:** `docker compose down -v` also **deletes the data volume**, which
> means every imported work. Do not use `-v` unless you want to start from an
> empty database.

## Running the importer

```powershell
mise exec -- npm run import                      # import 10 records from offset 0 (the default)
mise exec -- npm run import -- --help            # show all options
```

Options (put them after `--`):

| Option | Meaning |
|---|---|
| `--limit N` | Number of raw IMSLP records to fetch in this run (default 10, maximum 5000) |
| `--page-size N` | Records per API request (default `IMPORT_PAGE_SIZE` or 1000, maximum 1000) |
| `--start N` | Offset to start a **new** run from (default 0) |
| `--resume` | Continue the latest failed or interrupted run from its saved offset |
| `--fresh` | Start a new run even though the latest run is unfinished (marks it as failed/abandoned) |

There is deliberately **no option to import the whole catalogue**. The importer
always stops after `--limit` records.

If the latest run did not finish, a plain `npm run import` refuses to start and
asks you to choose `--resume` or `--fresh`. That prevents accidentally
skipping or repeating work.

Example output of a first import into an empty database:

```
Importing up to 10 records, page size 10.
Started import run 1 at offset 0.
Page at offset 0: fetched 10, valid 10 (inserted 10, updated 0, unchanged 0), skipped 0

Import run 1: succeeded (limit reached)
  offsets:  0 -> 10
  fetched:  10 raw records in 1 page(s)
  works:    10 inserted, 0 updated, 0 unchanged
  skipped:  0
```

Running the same command again finds the same 10 works already stored. It
reports `0 inserted, 0 updated, 10 unchanged` and only adds a new row to
`import_runs`. (If IMSLP has changed one of those works in the meantime, it is
reported as `updated`.)

**Exit codes** (in PowerShell, check them with `$LASTEXITCODE`): `0` succeeded,
`1` import failed (the run is marked `failed` and can be resumed), `2` wrong
usage or another import is already running.

**Ctrl+C:** the first press finishes the current page and then stops; the run
can be resumed with `--resume`. A second press exits immediately; the page in
progress is rolled back and nothing half-written remains.

To look at raw IMSLP data **without touching the database**:

```powershell
mise exec -- npm run fetch:sample               # fetches 10 works and prints them
```

## Verifying an import

```powershell
mise exec -- npm run verify:import
```

This runs the checks in `scripts/verify-import.sql` inside a **read-only
transaction**, so it cannot change any data. It prints:

| Check | Healthy result |
|---|---|
| import runs | every finished run is `succeeded`, `error_message` is empty |
| works total and distinct permlinks | the two numbers are equal (no duplicates) |
| composers and orphan composers | `orphans` = 0 (every composer has at least one work) |
| works without composer / without import run | normally 0 and 0 (a work may legitimately have no composer if IMSLP gives none) |
| works per import run | which run last inserted or changed the works |
| imported works | the works with their composers |
| fingerprint of all work rows | an MD5 hash of all work rows; it stays **identical** after a repeat import if nothing changed |

## Running the tests

```powershell
# Offline tests: no network, no database (API client, parser, importer logic, repository input checks)
mise exec -- npm test

# Integration tests against PostgreSQL (Docker must be running and .env must exist)
mise exec -- npm run test:db
```

The integration tests **do not touch your imported data**. Each test file
creates its own temporary schema (`test_<random hex>`), runs there, drops it
afterwards and checks that the row counts of the real tables did not change.
Neither test suite makes requests to IMSLP; HTTP is replaced by fakes.

## Inspecting the data with SQL

Open `psql` as shown in [Starting and stopping PostgreSQL](#starting-and-stopping-postgresql),
then paste any of these queries. They only read data. More queries are in
[docs/DEMO.md](docs/DEMO.md#a3-look-at-the-data-with-sql-about-3-minutes).

**Works with their composer:**

```sql
SELECT c.name AS composer, w.title, w.catalogue_number, w.permlink
FROM works w
LEFT JOIN composers c ON c.id = w.composer_id
ORDER BY w.imslp_id;
```

**Import history:**

```sql
SELECT id, status, start_offset, next_offset, works_fetched, works_upserted,
       started_at, finished_at, error_message
FROM import_runs
ORDER BY id;
```

**Ad-hoc title lookup** (plain SQL pattern matching; this is *not* the planned
search feature):

```sql
SELECT c.name AS composer, w.title
FROM works w
LEFT JOIN composers c ON c.id = w.composer_id
WHERE w.title ILIKE '%waltz%';
```

## How the importer stays safe

### Error handling

- **Timeouts:** each request is aborted after `IMPORT_TIMEOUT_MS` (30 s).
- **Retries:** network errors, timeouts, HTTP 429 and HTTP 5xx are retried up to
  `IMPORT_RETRIES` (3) times with exponential backoff (2 s, 4 s, 8 s, capped at
  60 s). A longer `Retry-After` header from the server is respected. Other HTTP
  errors (for example 404) are not retried.
- **IMSLP application errors:** IMSLP reports errors as HTTP 200 with a JSON
  string body. The client detects this and treats it as an error, not as data.
- **Unexpected responses:** a response without valid `metadata`, a page for the
  wrong offset, more records than requested, or an empty page while IMSLP still
  reports more results all stop the import before that page is saved (pages
  saved earlier stay saved, and the run can be resumed).
- **Bad records:** handled by the parser, see below. One bad record never stops
  the import.
- **Failures are recorded:** a failed run is marked `failed` in `import_runs`
  with its `error_message`, and the importer exits with code 1.

### Parser decisions: missing fields, dates and time zones

The parser (`src/adapters/imslp/parser.js`) checks every record on its own:

- **Required fields missing or invalid → the record is skipped with a reason.**
  Required are `permlink` (must be an `http(s)` URL on `imslp.org`), `id`, the
  title (`intvals.worktitle`) and an `intvals` object; `type`, if present, must
  be `"2"`. A second record with the same permlink in one page is also skipped.
  The import summary shows up to 5 examples; the rest of the page is still saved.
- **Optional fields missing or invalid → stored as `NULL`** and the record is
  kept: composer, catalogue number, page id and parent.
- **Page ids are validated before conversion:** only a string of digits that
  gives a positive safe integer is converted to a number; anything else
  becomes `NULL`.
- **Text is only trimmed**, never otherwise changed, so accents and non-Latin
  names are stored exactly as IMSLP sends them.
- **Dates and time zones:** the only date IMSLP sends is
  `metadata.timestamp`, in Unix seconds. The parser converts it to a UTC
  JavaScript `Date`. The work records themselves have **no date field** (no
  composition or publication date), so there is no work date to store. The
  database's own timestamps (`created_at`, `updated_at`, `started_at`,
  `finished_at`) are `TIMESTAMPTZ`, set by PostgreSQL, so they are unambiguous
  in any time zone.

### Rate limiting

IMSLP's `robots.txt` asks for `Crawl-delay: 2`. The client waits at least
`IMPORT_DELAY_MS` (2,000 ms) between the starts of any two requests, including
retries. The importer also waits that long before its first request, so two
imports started one after another are spaced out too.

### Transaction safety

- **One page = one transaction.** The composers, the works *and* the run's
  progress (`next_offset`, counters) are written in the same transaction. Either
  the whole page is stored together with its checkpoint, or nothing is.
- **No page twice, no page skipped.** Before saving, the run row is locked and
  the page's offset must equal the run's stored `next_offset`; otherwise the
  save is rejected.
- **Atomic finish.** The last page also marks the run `succeeded` in the same
  transaction, so a crash can never leave a finished import that looks unfinished.
- **One importer at a time.** A PostgreSQL advisory lock ensures that a second
  importer process exits with code 2 without changing anything. If a process
  dies, PostgreSQL releases the lock automatically.
- **Idempotent upserts.** `INSERT ... ON CONFLICT` on `works.permlink` and
  `composers.name`. A work is only rewritten if one of its values actually
  changed; unchanged rows keep their `updated_at` and `last_import_run_id`.

### Resuming an import

`next_offset` counts **raw** records fetched, including skipped ones, so a
resumed run neither re-fetches nor misses anything. After a failure or Ctrl+C:

```powershell
mise exec -- npm run import -- --resume
```

> **Known limitation: `--resume` uses the current command's `--limit`.** A run
> does not remember the limit it was started with. `--limit` always means "raw
> records to fetch *in this command*", and its default is 10. If an import
> started with `--limit 3000` is interrupted after 1,000 records and resumed with
> plain `--resume`, it fetches only **10 more** records, then marks the run
> `succeeded` ("limit reached"). Nothing is duplicated or lost, but the original
> target is not reached. Always pass the remainder explicitly:
>
> ```powershell
> mise exec -- npm run import -- --resume --limit 2000   # 3000 target - 1000 already fetched
> ```
>
> `works_fetched` in `import_runs` shows how many records the run has fetched so
> far. If a run already ended early this way, continue with a new run from its
> `next_offset`: `npm run import -- --start <next_offset> --limit <remaining>`.

## Where the data lives

- **Git stores the code; Docker stores the data.** The imported composers,
  works and import runs live in the Docker volume `pgdata` (shown by Docker as
  `classical-sheet-music-finder_pgdata`). They are **not** part of the Git
  repository, are not affected by commits, checkouts or pushes, and someone who
  clones the repository starts with an empty database.
- The volume survives `docker compose stop`, `docker compose down`, restarting
  Docker Desktop and rebooting. Only `docker compose down -v` (or deleting the
  volume in Docker Desktop) removes it.
- Schema changes are made only with new files in `db/migrations/` and
  `npm run migrate`. Never edit an applied migration: the runner checks
  checksums and stops if one changed.

## Limitations and future work

**Current limitations (what is implemented today):**

- Only a **10-work sample** has been imported. IMSLP lists about 269,000 works.
- One run imports at most 5,000 records (`--limit`). There is intentionally no
  `--all` option; a full import requires the project owner's explicit approval.
- Only work records (`type=2`) and only the fields listed in the schema are
  stored. Composer names are stored exactly as IMSLP writes them; there is no
  name normalization or composer metadata (dates, nationality).
- `--resume` does not remember the original `--limit` (see
  [Resuming an import](#resuming-an-import)).
- No database migration tool; schema changes need manual handling.
- Usable through the command line and SQL only.

**Planned / future work (not implemented):**

- **Larger and full-catalogue imports:** many runs of up to 5,000 records, or a
  reviewed change to the limit, at 1,000 records per request with a 2-second
  crawl delay.
- **Search functionality:** for example by composer, title and catalogue number,
  probably using PostgreSQL full-text search with suitable indexes.
- **Voice-category classification:** tagging works by voice type or ensemble
  (e.g. soprano, SATB choir). This needs data that the current import does not
  fetch.
- **A user interface** (web) on top of the search.
- **Schema migrations** and scheduled incremental updates.

## Data source

Data comes from the IMSLP API (<https://imslp.org/wiki/IMSLP:API>). This
project stores only metadata (titles, composer names, catalogue numbers and
links), not scores. It respects IMSLP's `Crawl-delay: 2` and fetches only as
many records as explicitly requested.
