// PostgreSQL connection pool and transaction helper.
//
// Knows nothing about IMSLP. Credentials come from environment variables
// (loaded from .env with `node --env-file-if-exists=.env`). Error messages
// name a missing or invalid variable but never print its value.

import pg from 'pg';

const REQUIRED_VARS = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];

const POOL_DEFAULTS = {
  max: 4, // the importer works one page at a time; a few connections is plenty
  connectionTimeoutMillis: 10_000, // fail fast if the database is unreachable
  idleTimeoutMillis: 30_000,
};

// Builds a pg connection config from environment variables.
export function readDbConfig(env = process.env) {
  const missing = REQUIRED_VARS.filter((name) => !env[name] || env[name].trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing database environment variable(s): ${missing.join(', ')}. See .env.example.`);
  }

  const portText = (env.POSTGRES_PORT ?? '5432').trim();
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid POSTGRES_PORT: must be an integer between 1 and 65535.');
  }

  return {
    host: env.POSTGRES_HOST?.trim() || 'localhost',
    port,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
  };
}

// Creates a connection pool. `options` overrides the pool defaults
// (for example `max`, or `options: '-c search_path=...'` in tests).
export function createPool(config = readDbConfig(), options = {}) {
  const pool = new pg.Pool({ ...POOL_DEFAULTS, ...config, ...options });
  // Without a listener, an idle client losing its connection would crash the
  // process. pg removes the broken client from the pool by itself.
  pool.on('error', (error) => {
    console.error(`PostgreSQL idle client error: ${error.message}`);
  });
  return pool;
}

// Runs fn(client) inside BEGIN ... COMMIT on one pooled connection.
// On any error: ROLLBACK, then re-throw the original error.
// The client is always released. If ROLLBACK itself fails, the connection is
// in an unknown state, so it is released with the error and pg destroys it
// instead of returning it to the pool.
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  let brokenConnectionError;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      brokenConnectionError = rollbackError;
    }
    throw error;
  } finally {
    client.release(brokenConnectionError);
  }
}
