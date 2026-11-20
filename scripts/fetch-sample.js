// Fetches exactly 10 real works from IMSLP and prints a short summary.
// Does not write anything to the database.
//
// Usage: mise exec -- npm run fetch:sample

import { createImslpClient } from '../src/imslpClient.js';

const SAMPLE_SIZE = 10;

// Reads an optional numeric setting from .env; undefined means "use the default".
function numberFromEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number, got "${value}"`);
  return number;
}

const client = createImslpClient({
  baseUrl: process.env.IMSLP_BASE_URL || undefined,
  timeoutMs: numberFromEnv('IMPORT_TIMEOUT_MS'),
  retries: numberFromEnv('IMPORT_RETRIES'),
  delayMs: numberFromEnv('IMPORT_DELAY_MS'),
});

try {
  const startedAt = Date.now();
  const { works, metadata } = await client.fetchWorksPage({ start: 0, limit: SAMPLE_SIZE });
  const elapsedMs = Date.now() - startedAt;

  console.log(`Fetched ${works.length} works in ${elapsedMs} ms`);
  console.log('Metadata:', {
    ...metadata,
    timestampIso: new Date(metadata.timestamp * 1000).toISOString(),
  });
  console.log('');

  works.forEach((work, index) => {
    // Raw records: read fields defensively, the parser (Step 3) does the real checks.
    const composer = work?.intvals?.composer ?? '(no composer)';
    const title = work?.intvals?.worktitle ?? '(no title)';
    console.log(`${String(index + 1).padStart(2)}. ${composer} | ${title}`);
    console.log(`    ${work?.permlink ?? '(no permlink)'}`);
  });

  const checks = [
    [`received ${SAMPLE_SIZE} works`, works.length === SAMPLE_SIZE],
    ['metadata.start is 0', metadata.start === 0],
    [`metadata.limit is ${SAMPLE_SIZE}`, metadata.limit === SAMPLE_SIZE],
    ['metadata.moreResultsAvailable is true', metadata.moreResultsAvailable === true],
    ['metadata.timestamp is a number', typeof metadata.timestamp === 'number'],
  ];
  console.log('');
  for (const [label, ok] of checks) console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
} catch (error) {
  console.error(`Failed to fetch works: ${error.message}`);
  process.exitCode = 1;
}
