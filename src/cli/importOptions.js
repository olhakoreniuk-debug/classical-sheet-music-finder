// Command-line options for `npm run import` (architecture C5): parsing argv,
// reading settings from the environment, and the help text. No I/O here; the
// composition root (scripts/import.js) prints and exits.

import { parseArgs } from 'node:util';
import { UsageError } from '../core/errors.js';

export { UsageError };

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT_WITHOUT_APPROVAL = 5000; // there is deliberately no --all
export const MAX_PAGE_SIZE = 1000; // IMSLP maximum
export const DEFAULT_PAGE_SIZE = 1000;
export const DEFAULT_CRAWL_DELAY_MS = 2000; // IMSLP robots.txt: Crawl-delay: 2

export const USAGE = `Usage: npm run import -- [options]

  --limit N       raw IMSLP records to fetch in this run (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT_WITHOUT_APPROVAL})
  --page-size N   records per API request (default IMPORT_PAGE_SIZE or ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE})
  --start N       offset for a new run (default 0; not with --resume)
  --resume        continue the latest failed or interrupted run from its next offset
  --fresh         start a new run even if the latest run is unfinished
  --help          show this help`;

// ---------- options ----------

function parseInteger(text, name, min, max) {
  const trimmed = String(text).trim();
  const number = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new UsageError(`${name} must be an integer from ${min} to ${max}, got "${text}"`);
  }
  return number;
}

// Parses command-line arguments (without "node script.js").
export function parseImportOptions(argv, env = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        limit: { type: 'string' },
        'page-size': { type: 'string' },
        start: { type: 'string' },
        resume: { type: 'boolean', default: false },
        fresh: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }

  if (values.help) return { help: true };

  const limit = values.limit === undefined
    ? DEFAULT_LIMIT
    : parseInteger(values.limit, '--limit', 1, MAX_LIMIT_WITHOUT_APPROVAL);

  let pageSize = DEFAULT_PAGE_SIZE;
  if (values['page-size'] !== undefined) {
    pageSize = parseInteger(values['page-size'], '--page-size', 1, MAX_PAGE_SIZE);
  } else if (env.IMPORT_PAGE_SIZE !== undefined && env.IMPORT_PAGE_SIZE.trim() !== '') {
    pageSize = parseInteger(env.IMPORT_PAGE_SIZE, 'IMPORT_PAGE_SIZE', 1, MAX_PAGE_SIZE);
  }

  if (values.resume && values.fresh) throw new UsageError('--resume and --fresh cannot be used together');
  if (values.resume && values.start !== undefined) {
    throw new UsageError('--start cannot be used with --resume (a resumed run continues from its own offset)');
  }
  const start = values.start === undefined
    ? 0
    : parseInteger(values.start, '--start', 0, 2_147_483_647); // import_runs offsets are INTEGER

  return { help: false, limit, pageSize, start, resume: values.resume, fresh: values.fresh };
}

// Settings for createImslpClient from the environment (undefined = client default).
export function readClientOptions(env = {}) {
  const number = (name) => {
    const value = env[name];
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new UsageError(`${name} must be a number >= 0, got "${value}"`);
    }
    return parsed;
  };
  return {
    baseUrl: env.IMSLP_BASE_URL?.trim() || undefined,
    timeoutMs: number('IMPORT_TIMEOUT_MS'),
    retries: number('IMPORT_RETRIES'),
    delayMs: number('IMPORT_DELAY_MS'),
  };
}
