# ADR-0006: Database schema changes only through migrations (decision D-4)

- **Status:** Accepted (decision approved by the project owner). **Not yet
  implemented:** the change is made in stage T1.
- **Date:** 2026-11-27
- **Resolves:** open decision D-4 of architecture v2
  ("Stop running `db/schema.sql` automatically on a new Docker volume?").

## Context

Today `docker-compose.yml` mounts `db/schema.sql` into
`/docker-entrypoint-initdb.d/`, so PostgreSQL runs it automatically, but only
when a Docker volume is created empty. The file uses
`CREATE TABLE IF NOT EXISTS`, which never changes existing tables. As a
result:

- a database created from scratch and a database that already exists can
  silently end up with different schemas;
- schema changes for Assignment 2 (migration 0002, ADR-0002) and the later
  stages cannot be applied reliably;
- there is no record of which schema version a database has.

Stage T1 introduces a migration runner (architecture v2, AD-3): versioned SQL
files in `db/migrations/`, applied in order, recorded in `schema_migrations`
with checksums.

## Decision

1. **The only way to create or change the schema is the migration runner**
   (`npm run migrate`), for new and existing databases alike.
2. **`docker-compose.yml` stops running `db/schema.sql` automatically** on a
   new volume. A new database starts empty; `npm run migrate` creates the
   tables.
3. **Existing data is preserved:**
   - the existing database is **baselined**: `0001_baseline.sql` (today's
     schema) is recorded as applied without being executed, after checking
     that the expected tables exist;
   - a `pg_dump` backup is taken before the first migration of the real
     database;
   - row counts (10 works, 10 composers, 2 import runs) and a fingerprint of
     the original columns are compared before and after.
4. `db/schema.sql` is retired in favour of `db/migrations/0001_baseline.sql`
   in the same stage.

## Implementation

Part of stage **T1** (ADR-0001), on its own feature branch, after approval.
Nothing in this ADR is implemented during the contract phase: Docker
configuration, `db/schema.sql` and the database are unchanged.

## Consequences

- One reliable path to the same schema on every machine and in every test.
- Setting up a new computer needs one extra command (`npm run migrate`); the
  README's first-time setup is updated in T1.
- Removing the init mount does not affect the existing Docker volume or its
  data.

## Alternatives considered

- **Keep the automatic `schema.sql` and add migrations on top:** two sources
  of truth for the schema. Rejected.
- **Run migrations automatically when the container starts:** hides schema
  changes and their failures from the developer. Rejected for now; can be
  revisited for deployment.
