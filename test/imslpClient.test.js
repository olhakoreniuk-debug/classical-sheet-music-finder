// Offline tests for the IMSLP client. No network: fetch, sleep and the clock
// are replaced with fakes, so the tests are fast and deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorksUrl,
  validateWorksResponse,
  createImslpClient,
  ImslpApiError,
} from '../src/adapters/imslp/imslpClient.js';

// ---------- helpers ----------

const sampleWork = {
  id: 'Symphony No.5, Op.67 (Beethoven, Ludwig van)',
  type: '2',
  parent: 'Category:Beethoven, Ludwig van',
  intvals: { composer: 'Beethoven, Ludwig van', worktitle: 'Symphony No.5', icatno: 'Op.67', pageid: '1234' },
  permlink: 'https://imslp.org/wiki/Symphony_No.5,_Op.67_(Beethoven,_Ludwig_van)',
};

function page(works, more = true) {
  const body = {};
  works.forEach((work, i) => { body[String(i)] = work; });
  body.metadata = {
    start: 0, limit: works.length, sortby: 'id', sortdirection: 'ASC',
    moreresultsavailable: more, timestamp: 1795208110, apiversion: 10,
  };
  return body;
}

// A Response like IMSLP sends: JSON text with Content-Type text/plain.
function textResponse(body, status = 200, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain', ...headers } });
}

// Fake fetch that plays back a list of steps: a Response, an Error to throw,
// or a function (url, init) => Promise. Records each call.
function fakeFetch(steps) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(url, init);
    return step.clone();
  };
  return { fetchFn, calls };
}

// Fake clock: sleeping just moves time forward and records the duration.
function fakeClock() {
  const clock = {
    now: 0,
    sleeps: [],
    nowFn: () => clock.now,
    sleepFn: async (ms) => { clock.sleeps.push(ms); clock.now += ms; },
  };
  return clock;
}

function makeClient(steps, options = {}) {
  const fetch = fakeFetch(steps);
  const clock = fakeClock();
  const logs = [];
  const client = createImslpClient({
    fetchFn: fetch.fetchFn,
    sleepFn: clock.sleepFn,
    nowFn: clock.nowFn,
    log: (message) => logs.push(message),
    ...options,
  });
  return { client, calls: fetch.calls, clock, logs };
}

// A fetch that never answers; it rejects only when the timeout signal fires,
// exactly like the real fetch does.
function hangUntilAborted(url, { signal }) {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

// ---------- buildWorksUrl ----------

test('buildWorksUrl builds the slash-separated IMSLP URL', () => {
  assert.equal(
    buildWorksUrl({ start: 0, limit: 10 }),
    'https://imslp.org/imslpscripts/API.ISCR.php?account=worklist/disclaimer=accepted/sort=id/type=2/start=0/limit=10/retformat=json',
  );
});

test('buildWorksUrl rejects invalid start and limit', () => {
  assert.throws(() => buildWorksUrl({ start: -1, limit: 10 }), RangeError);
  assert.throws(() => buildWorksUrl({ start: 1.5, limit: 10 }), RangeError);
  assert.throws(() => buildWorksUrl({ start: 0, limit: 0 }), RangeError);
  assert.throws(() => buildWorksUrl({ start: 0, limit: 1001 }), RangeError);
  assert.throws(() => buildWorksUrl({ start: '0', limit: 10 }), RangeError);
});

// ---------- validateWorksResponse ----------

test('validateWorksResponse returns works in numeric key order and maps metadata', () => {
  const body = {
    10: { id: 'k10' }, 2: { id: 'k2' }, 0: { id: 'k0' }, 1: { id: 'k1' },
    metadata: { start: 0, limit: 11, sortby: 'id', moreresultsavailable: false, timestamp: 1795208110 },
  };
  const { works, metadata } = validateWorksResponse(body);
  assert.deepEqual(works.map((w) => w.id), ['k0', 'k1', 'k2', 'k10']);
  assert.deepEqual(metadata, { start: 0, limit: 11, moreResultsAvailable: false, timestamp: 1795208110 });
});

test('validateWorksResponse keeps malformed work records raw for the parser', () => {
  const malformed = [sampleWork, null, { id: 5 }, 'not an object', { intvals: {} }];
  const body = page(malformed);
  const { works } = validateWorksResponse(body);
  assert.equal(works.length, 5);
  assert.deepEqual(works, malformed);
  assert.equal(works[0], body['0'], 'the same raw object is passed through, not a copy');
});

test('validateWorksResponse accepts an empty page', () => {
  const { works, metadata } = validateWorksResponse(page([], false));
  assert.deepEqual(works, []);
  assert.equal(metadata.moreResultsAvailable, false);
});

test('validateWorksResponse treats a JSON string body as an IMSLP application error', () => {
  assert.throws(
    () => validateWorksResponse('Disclaimer not accepted.'),
    (err) => err instanceof ImslpApiError && !err.retryable && /Disclaimer not accepted/.test(err.message),
  );
});

test('validateWorksResponse rejects a broken overall structure', () => {
  assert.throws(() => validateWorksResponse(null), ImslpApiError);
  assert.throws(() => validateWorksResponse([]), ImslpApiError);
  assert.throws(() => validateWorksResponse({ 0: sampleWork }), /metadata/);
  assert.throws(
    () => validateWorksResponse({ 0: sampleWork, metadata: { moreresultsavailable: 'yes' } }),
    /moreresultsavailable/,
  );
});

// ---------- fetchWorksPage: success and non-retryable errors ----------

test('fetchWorksPage returns raw works and metadata on success', async () => {
  const { client, calls, clock } = makeClient([textResponse(page([sampleWork]))]);
  const result = await client.fetchWorksPage({ start: 0, limit: 1 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /start=0\/limit=1\/retformat=json$/);
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'request has a timeout signal');
  assert.deepEqual(result.works, [sampleWork]);
  assert.equal(result.metadata.moreResultsAvailable, true);
  assert.deepEqual(clock.sleeps, []);
});

test('an application error string fails immediately without retry', async () => {
  const { client, calls } = makeClient([textResponse('"Disclaimer not accepted."')]);
  await assert.rejects(client.fetchWorksPage({ start: 0, limit: 10 }), /IMSLP API error: Disclaimer not accepted/);
  assert.equal(calls.length, 1);
});

test('HTTP 404 is not retried', async () => {
  const { client, calls } = makeClient([textResponse('Not found', 404)]);
  await assert.rejects(
    client.fetchWorksPage({ start: 0, limit: 10 }),
    (err) => err instanceof ImslpApiError && err.status === 404 && !err.retryable,
  );
  assert.equal(calls.length, 1);
});

test('invalid JSON is not retried', async () => {
  const { client, calls } = makeClient([textResponse('<html>oops</html>')]);
  await assert.rejects(client.fetchWorksPage({ start: 0, limit: 10 }), /not valid JSON/);
  assert.equal(calls.length, 1);
});

// ---------- fetchWorksPage: retries ----------

test('HTTP 503 is retried with backoff and then succeeds', async () => {
  const { client, calls, clock, logs } = makeClient([
    textResponse('busy', 503),
    textResponse(page([sampleWork])),
  ]);
  const result = await client.fetchWorksPage({ start: 0, limit: 1 });
  assert.equal(calls.length, 2);
  assert.deepEqual(clock.sleeps, [2000]);
  assert.equal(result.works.length, 1);
  assert.match(logs[0], /retry 1\/3 in 2000 ms: HTTP 503/);
});

test('HTTP 429 waits for a longer Retry-After header', async () => {
  const { client, clock } = makeClient([
    textResponse('slow down', 429, { 'Retry-After': '5' }),
    textResponse(page([sampleWork])),
  ]);
  await client.fetchWorksPage({ start: 0, limit: 1 });
  assert.deepEqual(clock.sleeps, [5000]);
});

test('a network error is retried and then succeeds', async () => {
  const { client, calls } = makeClient([
    new TypeError('fetch failed'),
    textResponse(page([sampleWork])),
  ]);
  const result = await client.fetchWorksPage({ start: 0, limit: 1 });
  assert.equal(calls.length, 2);
  assert.equal(result.works.length, 1);
});

test('gives up after the configured retries with exponential backoff', async () => {
  const { client, calls, clock } = makeClient([textResponse('error', 500)]);
  await assert.rejects(
    client.fetchWorksPage({ start: 0, limit: 10 }),
    (err) => err.status === 500 && /gave up after 4 attempts/.test(err.message),
  );
  assert.equal(calls.length, 4); // 1 attempt + 3 retries
  assert.deepEqual(clock.sleeps, [2000, 4000, 8000]);
});

// ---------- fetchWorksPage: timeouts ----------

test('a timed-out request is retried and the retry succeeds', async () => {
  const { client, calls, clock, logs } = makeClient(
    [hangUntilAborted, textResponse(page([sampleWork]))],
    { timeoutMs: 20 }, // real AbortSignal.timeout, kept short
  );
  const result = await client.fetchWorksPage({ start: 0, limit: 1 });
  assert.equal(calls.length, 2);
  assert.equal(result.works.length, 1);
  assert.deepEqual(clock.sleeps, [2000]);
  assert.match(logs[0], /retry 1\/3 in 2000 ms: Request timed out after 20 ms/);
});

test('repeated timeouts give up after the configured retries', async () => {
  const { client, calls } = makeClient([hangUntilAborted], { timeoutMs: 20, retries: 1 });
  await assert.rejects(
    client.fetchWorksPage({ start: 0, limit: 10 }),
    (err) => err instanceof ImslpApiError
      && err.retryable
      && /Request timed out after 20 ms \(gave up after 2 attempts\)/.test(err.message)
      && err.cause.cause.name === 'TimeoutError',
  );
  assert.equal(calls.length, 2);
});

// ---------- crawl delay ----------

test('waits for the crawl delay between consecutive requests', async () => {
  const ok = textResponse(page([sampleWork]));
  const { client, clock } = makeClient([ok]);

  await client.fetchWorksPage({ start: 0, limit: 1 });
  assert.deepEqual(clock.sleeps, [], 'first request does not wait');

  await client.fetchWorksPage({ start: 1, limit: 1 });
  assert.deepEqual(clock.sleeps, [2000], 'second request right after waits the full delay');

  clock.now += 1500; // pretend 1.5 s passed doing other work
  await client.fetchWorksPage({ start: 2, limit: 1 });
  assert.deepEqual(clock.sleeps, [2000, 500], 'only the remaining 0.5 s is waited');
});
