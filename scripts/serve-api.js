// npm run api: starts the REST API (composition root, ADR-0004).
// Reads configuration, creates the PostgreSQL adapters, binds them to the core
// use cases and starts Express. Never prints credentials.
//
// Configuration (.env):
//   API_HOST              default 127.0.0.1 (loopback only, ADR-0003)
//   API_PORT              default 3000
//   API_WRITES_ENABLED    'true' to allow POST /works (default: writes disabled)
//   API_ALLOWED_ORIGINS   extra origins allowed to write, comma-separated
//                         (e.g. the Vite dev server http://localhost:5173)

import { createPool, readDbConfig } from '../src/adapters/postgres/db.js';
import {
  createPostgresSourceQueries,
  createPostgresWorkCommands,
  createPostgresWorkQueries,
} from '../src/adapters/postgres/catalogRepository.js';
import { createWork } from '../src/core/catalog/createWork.js';
import { getWork } from '../src/core/catalog/getWork.js';
import { listSources } from '../src/core/catalog/listSources.js';
import { listWorks } from '../src/core/catalog/listWorks.js';
import { loadContract } from '../src/web/contract.js';
import { createApp } from '../src/web/createApp.js';
import { createIdempotencyStore } from '../src/web/idempotency.js';

function readApiConfig(env) {
  const host = env.API_HOST?.trim() || '127.0.0.1';
  const portText = env.API_PORT?.trim() || '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65_535) throw new Error('Invalid API_PORT: must be 1-65535.');
  const own = [`http://${host}:${port}`, `http://localhost:${port}`, `http://127.0.0.1:${port}`];
  const extra = (env.API_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return {
    host,
    port,
    writesEnabled: env.API_WRITES_ENABLED?.trim().toLowerCase() === 'true',
    allowedOrigins: [...new Set([...own, ...extra])],
  };
}

const config = readApiConfig(process.env);
const pool = createPool(readDbConfig(), { max: 10 });
const ports = {
  workQueries: createPostgresWorkQueries(pool),
  workCommands: createPostgresWorkCommands(pool),
  sourceQueries: createPostgresSourceQueries(pool),
};
const app = createApp({
  useCases: {
    listWorks: (criteria) => listWorks(ports, criteria),
    getWork: (workId) => getWork(ports, workId),
    createWork: (input) => createWork(ports, input),
    listSources: () => listSources(ports),
  },
  contract: await loadContract(new URL('../openapi.yaml', import.meta.url)),
  idempotency: createIdempotencyStore(),
  config,
});

const server = app.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port}/api/v1 (writes ${config.writesEnabled ? 'enabled' : 'disabled'})`);
});

async function shutdown() {
  server.close();
  await pool.end();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
