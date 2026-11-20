// Offline tests for the import pipeline. No network, no database:
// a scripted fake IMSLP client and an in-memory fake repository that enforces
// the same rules as the real one (offset check, 'running' check, finish flag).
// The real parser is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runImport,
  parseImportOptions,
  readClientOptions,
  formatSummary,
  UsageError,
  DEFAULT_LIMIT,
} from '../src/importer.js';
import { parseWorksPage } from '../src/parser.js';
import { createImslpClient } from '../src/imslpClient.js';
import { ImportRunStateError, OffsetMismatchError } from '../src/repository.js';

// ---------- fake IMSLP data ----------

function rawRecord(n, { valid = true } = {}) {
  return {
    id: `Work ${n} (Composer ${n % 3})`,
    type: '2',
    parent: `Category:Composer ${n % 3}`,
    intvals: valid
      ? { composer: `Composer ${n % 3}`, worktitle: `Work ${n}`, icatno: `Op.${n}`, pageid: String(100 + n) }
      : { composer: `Composer ${n % 3}` }, // no worktitle -> parser skips it
    permlink: `https://imslp.org/wiki/Work_${n}`,
  };
}

// A catalogue of `total` records; `invalid` = set of offsets the parser must skip.
function catalogue(total, { invalid = new Set() } = {}) {
  return ({ start, limit }) => {
    const count = Math.max(0, Math.min(limit, total - start));
    const works = Array.from({ length: count }, (_, i) => rawRecord(start + i, { valid: !invalid.has(start + i) }));
    return { works, metadata: { start, limit, moreResultsAvailable: start + count < total, timestamp: 1795208110 } };
  };
}

// handler({ start, limit }) returns a page or throws.
function fakeClient(handler) {
  const requests = [];
  return {
    requests,
    async fetchWorksPage(args) {
      requests.push(args);
      return handler(args, requests.length);
    },
  };
}

// ---------- fake repository ----------

function fakeRepo({ runs = [], failSaveAt } = {}) {
  const state = { runs: runs.map((run) => ({ ...run })), saves: [], finishCalls: [], resumed: [], started: [] };
  const copy = (run) => ({ ...run });
  const findRun = (id) => state.runs.find((run) => run.id === id);
  const repo = {
    state,
    async findResumableRun() {
      const latest = state.runs.at(-1);
      return latest && latest.status !== 'succeeded' ? copy(latest) : null;
    },
    async startImportRun(_pool, { startOffset }) {
      const run = {
        id: state.runs.length + 1, status: 'running', startOffset, nextOffset: startOffset,
        worksFetched: 0, worksUpserted: 0, errorMessage: null,
      };
      state.runs.push(run);
      state.started.push(run.id);
      return copy(run);
    },
    async resumeImportRun(_pool, id) {
      const run = findRun(id);
      if (!run || run.status === 'succeeded') throw new ImportRunStateError('cannot resume');
      Object.assign(run, { status: 'running', errorMessage: null });
      state.resumed.push(id);
      return copy(run);
    },
    async finishImportRun(_pool, id, { status, errorMessage = null }) {
      state.finishCalls.push({ id, status, errorMessage });
      const run = findRun(id);
      if (!run || run.status !== 'running') throw new ImportRunStateError('not running');
      Object.assign(run, { status, errorMessage });
      return copy(run);
    },
    async savePage(_pool, { runId, pageStart, works, fetchedCount, finish }) {
      if (failSaveAt !== undefined && pageStart === failSaveAt) throw new Error('database unavailable');
      const run = findRun(runId);
      if (!run || run.status !== 'running') throw new ImportRunStateError('not running');
      if (run.nextOffset !== pageStart) throw new OffsetMismatchError(runId, pageStart, run.nextOffset);
      state.saves.push({ runId, pageStart, fetchedCount, permlinks: works.map((w) => w.permlink), finish });
      run.nextOffset = pageStart + fetchedCount;
      run.worksFetched += fetchedCount;
      run.worksUpserted += works.length;
      if (finish) run.status = 'succeeded';
      return { inserted: works.length, updated: 0, unchanged: 0, composersInserted: 0, nextOffset: run.nextOffset, finished: finish };
    },
  };
  return repo;
}

function options(overrides = {}) {
  return { help: false, limit: 10, pageSize: 1000, start: 0, resume: false, fresh: false, ...overrides };
}

function importWith({ client, repo, opts, ...rest }) {
  return runImport({
    pool: {}, client, parsePage: parseWorksPage, repo, options: options(opts), log: () => {}, ...rest,
  });
}

// ---------- happy path and pagination ----------

test('default import: one request for 10 records, one final save, run succeeded', async () => {
  const client = fakeClient(catalogue(100));
  const repo = fakeRepo();
  const summary = await importWith({ client, repo });
  assert.deepEqual(client.requests, [{ start: 0, limit: 10 }]);
  assert.equal(repo.state.saves.length, 1);
  assert.deepEqual(repo.state.saves[0].pageStart, 0);
  assert.equal(repo.state.saves[0].fetchedCount, 10);
  assert.equal(repo.state.saves[0].finish, true, 'final page must finish the run atomically');
  assert.equal(repo.state.finishCalls.length, 0, 'success needs no separate finish call');
  assert.equal(repo.state.runs[0].status, 'succeeded');
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.stopReason, 'limit reached');
  assert.equal(summary.recordsFetched, 10);
  assert.equal(summary.inserted, 10);
  assert.equal(summary.nextOffset, 10);
});

test('pages through the limit: (0,10), (10,10), (20,5); only the last save finishes', async () => {
  const client = fakeClient(catalogue(100));
  const repo = fakeRepo();
  const summary = await importWith({ client, repo, opts: { limit: 25, pageSize: 10 } });
  assert.deepEqual(client.requests, [{ start: 0, limit: 10 }, { start: 10, limit: 10 }, { start: 20, limit: 5 }]);
  assert.deepEqual(repo.state.saves.map((s) => [s.pageStart, s.fetchedCount, s.finish]),
    [[0, 10, false], [10, 10, false], [20, 5, true]]);
  assert.equal(summary.pages, 3);
  assert.equal(summary.nextOffset, 25);
});

test('offsets advance by the RAW record count when records are skipped', async () => {
  const client = fakeClient(catalogue(100, { invalid: new Set([2, 5, 7]) }));
  const repo = fakeRepo();
  const summary = await importWith({ client, repo, opts: { limit: 20, pageSize: 10 } });
  assert.deepEqual(client.requests.map((r) => r.start), [0, 10]);
  assert.equal(repo.state.saves[0].fetchedCount, 10);
  assert.equal(repo.state.saves[0].permlinks.length, 7);
  assert.equal(summary.skipped, 3);
  assert.deepEqual(summary.skippedSamples.map((s) => s.offset), [2, 5, 7]);
  assert.equal(summary.recordsFetched, 20);
  assert.equal(summary.nextOffset, 20);
});

test('a page where every record is skipped still advances the offset', async () => {
  const client = fakeClient(catalogue(100, { invalid: new Set([0, 1, 2, 3, 4]) }));
  const repo = fakeRepo();
  const summary = await importWith({ client, repo, opts: { limit: 10, pageSize: 5 } });
  assert.deepEqual(repo.state.saves.map((s) => [s.pageStart, s.fetchedCount, s.permlinks.length]),
    [[0, 5, 0], [5, 5, 5]]);
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.nextOffset, 10);
});

test('stops at the end of the catalogue before the limit', async () => {
  const client = fakeClient(catalogue(13));
  const repo = fakeRepo();
  const summary = await importWith({ client, repo, opts: { limit: 50, pageSize: 10 } });
  assert.deepEqual(client.requests.map((r) => [r.start, r.limit]), [[0, 10], [10, 10]]);
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.stopReason, 'end of catalogue');
  assert.equal(summary.nextOffset, 13);
  assert.equal(repo.state.saves.at(-1).finish, true);
});

test('an empty final page (moreResultsAvailable false) finishes the run without works', async () => {
  const client = fakeClient(catalogue(10));
  const repo = fakeRepo();
  const summary = await importWith({ client, repo, opts: { limit: 50, pageSize: 10 } });
  // page 1 (0..9) says moreResultsAvailable false -> finishes right there
  assert.equal(summary.status, 'succeeded');
  assert.equal(client.requests.length, 1);

  const client2 = fakeClient(() => ({ works: [], metadata: { start: 0, moreResultsAvailable: false } }));
  const repo2 = fakeRepo();
  const summary2 = await importWith({ client: client2, repo: repo2 });
  assert.equal(summary2.status, 'succeeded');
  assert.deepEqual(repo2.state.saves.map((s) => [s.pageStart, s.fetchedCount, s.finish]), [[0, 0, true]]);
});

// ---------- bad pages: no infinite loop, offsets protected ----------

test('an empty page while IMSLP reports more results fails the run without looping', async () => {
  const client = fakeClient(({ start }) => ({ works: [], metadata: { start, moreResultsAvailable: true } }));
  const repo = fakeRepo();
  const summary = await importWith({ client, repo, opts: { limit: 5000 } });
  assert.equal(client.requests.length, 1);
  assert.equal(summary.status, 'failed');
  assert.match(summary.error, /empty page at offset 0/);
  assert.equal(repo.state.saves.length, 0);
  assert.equal(repo.state.runs[0].status, 'failed');
  assert.equal(repo.state.runs[0].nextOffset, 0);
  assert.equal(summary.runMarkedFailed, true);
});

test('a page reporting a different start is rejected before saving', async () => {
  const client = fakeClient(({ limit }) => catalogue(100)({ start: 1, limit }));
  const repo = fakeRepo();
  const summary = await importWith({ client, repo });
  assert.equal(summary.status, 'failed');
  assert.match(summary.error, /start=1/);
  assert.equal(repo.state.saves.length, 0);
});

test('a page with more records than requested is rejected before saving', async () => {
  const client = fakeClient(({ start }) => catalogue(100)({ start, limit: 20 }));
  const repo = fakeRepo();
  const summary = await importWith({ client, repo });
  assert.equal(summary.status, 'failed');
  assert.match(summary.error, /at most 10 were requested/);
  assert.equal(repo.state.saves.length, 0);
});

// ---------- errors ----------

test('an API error on page 2 keeps page 1, marks the run failed and keeps next_offset', async () => {
  const data = catalogue(100);
  const client = fakeClient((args, n) => {
    if (n === 2) throw new Error('HTTP 503 (gave up after 4 attempts)');
    return data(args);
  });
  const repo = fakeRepo();
  const summary = await importWith({ client, repo, opts: { limit: 30, pageSize: 10 } });
  assert.equal(summary.status, 'failed');
  assert.equal(repo.state.saves.length, 1);
  const run = repo.state.runs[0];
  assert.equal(run.status, 'failed');
  assert.equal(run.errorMessage, 'HTTP 503 (gave up after 4 attempts)');
  assert.equal(run.nextOffset, 10);
  assert.match(formatSummary(summary), /--resume/);
});

test('a database error while saving marks the run failed', async () => {
  const client = fakeClient(catalogue(100));
  const repo = fakeRepo({ failSaveAt: 0 });
  const summary = await importWith({ client, repo });
  assert.equal(summary.status, 'failed');
  assert.equal(repo.state.runs[0].status, 'failed');
  assert.equal(repo.state.runs[0].errorMessage, 'database unavailable');
});

for (const ErrorClass of [OffsetMismatchError, ImportRunStateError]) {
  test(`${ErrorClass.name} is reported but the run is NOT marked failed`, async () => {
    const client = fakeClient(catalogue(100));
    const repo = fakeRepo();
    repo.savePage = async () => { throw new ErrorClass(1, 0, 10); };
    const summary = await importWith({ client, repo });
    assert.equal(summary.status, 'failed');
    assert.equal(summary.runMarkedFailed, false);
    assert.equal(repo.state.finishCalls.length, 0);
    assert.equal(repo.state.runs[0].status, 'running');
    assert.match(formatSummary(summary), /NOT changed/);
  });
}

// ---------- real client: retries and crawl delay ----------

function fakeHttp(responses) {
  let i = 0;
  return async (url) => {
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (typeof next === 'number') return new Response('error', { status: next });
    return new Response(JSON.stringify(next(url)), { status: 200 });
  };
}

function imslpBody(url) {
  const start = Number(/start=(\d+)/.exec(url)[1]);
  const limit = Number(/limit=(\d+)/.exec(url)[1]);
  const page = catalogue(100)({ start, limit });
  const body = { metadata: { start, limit, moreresultsavailable: page.metadata.moreResultsAvailable, timestamp: 1795208110 } };
  page.works.forEach((work, index) => { body[String(index)] = work; });
  return body;
}

test('retries through the real client: HTTP 503 then success imports normally', async () => {
  const sleeps = [];
  const warnings = [];
  const client = createImslpClient({
    fetchFn: fakeHttp([503, imslpBody]),
    sleepFn: async (ms) => { sleeps.push(ms); },
    nowFn: () => 0,
    log: (message) => warnings.push(message),
    delayMs: 2000,
    retries: 3,
  });
  const repo = fakeRepo();
  const summary = await importWith({ client, repo });
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.inserted, 10);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /retry 1\/3/);
});

test('crawl delay: waits before the first request and between pages', async () => {
  let now = 0;
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); now += ms; };
  const client = createImslpClient({
    fetchFn: fakeHttp([imslpBody]), sleepFn: sleep, nowFn: () => now, delayMs: 2000,
  });
  const repo = fakeRepo();
  const summary = await importWith({
    client, repo, opts: { limit: 20, pageSize: 10 }, sleep, startupDelayMs: 2000,
  });
  assert.equal(summary.status, 'succeeded');
  assert.deepEqual(sleeps, [2000, 2000], 'startup delay, then crawl delay before page 2');
});

// ---------- run selection and resumption ----------

const failedRun = {
  id: 1, status: 'failed', startOffset: 0, nextOffset: 20, worksFetched: 20, worksUpserted: 20, errorMessage: 'HTTP 503',
};

test('--resume continues a failed run from its next_offset', async () => {
  const client = fakeClient(catalogue(100));
  const repo = fakeRepo({ runs: [failedRun] });
  const summary = await importWith({ client, repo, opts: { resume: true, limit: 10 } });
  assert.deepEqual(repo.state.resumed, [1]);
  assert.deepEqual(repo.state.started, []);
  assert.deepEqual(client.requests, [{ start: 20, limit: 10 }]);
  assert.equal(summary.runId, 1);
  assert.equal(summary.startOffset, 20);
  assert.equal(summary.nextOffset, 30);
  assert.equal(repo.state.runs[0].status, 'succeeded');
});

test('--resume continues an interrupted run left in status running', async () => {
  const client = fakeClient(catalogue(100));
  const repo = fakeRepo({ runs: [{ ...failedRun, status: 'running', errorMessage: null }] });
  const summary = await importWith({ client, repo, opts: { resume: true } });
  assert.equal(summary.status, 'succeeded');
  assert.deepEqual(client.requests, [{ start: 20, limit: 10 }]);
});

test('crash after the final page commit: the run is already succeeded, --resume fetches nothing', async () => {
  const client = fakeClient(catalogue(100));
  const repo = fakeRepo();
  // Simulate the process dying right after the final savePage committed.
  const realSave = repo.savePage;
  repo.savePage = async (...args) => {
    await realSave(...args);
    throw new Error('process killed');
  };
  await importWith({ client, repo });
  assert.equal(repo.state.runs[0].status, 'succeeded', 'final page committed together with succeeded');

  const client2 = fakeClient(catalogue(100));
  await assert.rejects(importWith({ client: client2, repo, opts: { resume: true } }), UsageError);
  assert.equal(client2.requests.length, 0, 'no records beyond the original limit');
  assert.equal(repo.state.runs[0].nextOffset, 10);
});

test('refuses to start while an unfinished run exists, without fetching or creating a run', async () => {
  for (const status of ['failed', 'running']) {
    const client = fakeClient(catalogue(100));
    const repo = fakeRepo({ runs: [{ ...failedRun, status }] });
    await assert.rejects(importWith({ client, repo }), (error) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, new RegExp(`run 1 is ${status} at offset 20.*--resume.*--fresh`));
      return true;
    });
    assert.equal(client.requests.length, 0);
    assert.deepEqual(repo.state.started, []);
  }
});

test('--fresh abandons an interrupted running run and starts a new one at --start', async () => {
  const client = fakeClient(catalogue(100));
  const repo = fakeRepo({ runs: [{ ...failedRun, status: 'running', errorMessage: null }] });
  const summary = await importWith({ client, repo, opts: { fresh: true, start: 50 } });
  assert.equal(repo.state.runs[0].status, 'failed');
  assert.match(repo.state.runs[0].errorMessage, /abandoned/);
  assert.equal(summary.runId, 2);
  assert.deepEqual(client.requests, [{ start: 50, limit: 10 }]);
});

test('--fresh leaves an already failed run untouched', async () => {
  const client = fakeClient(catalogue(100));
  const repo = fakeRepo({ runs: [failedRun] });
  await importWith({ client, repo, opts: { fresh: true } });
  assert.equal(repo.state.finishCalls.length, 0);
  assert.equal(repo.state.runs[0].errorMessage, 'HTTP 503');
});

test('--resume with nothing to resume is a usage error', async () => {
  const client = fakeClient(catalogue(100));
  await assert.rejects(importWith({ client, repo: fakeRepo(), opts: { resume: true } }), UsageError);
  assert.equal(client.requests.length, 0);
});

test('an abort signal stops after the current page and leaves the run resumable', async () => {
  const controller = new AbortController();
  const data = catalogue(100);
  const client = fakeClient((args, n) => {
    if (n === 2) controller.abort(); // Ctrl+C while page 2 is being fetched
    return data(args);
  });
  const repo = fakeRepo();
  const summary = await importWith({
    client, repo, opts: { limit: 50, pageSize: 10 }, signal: controller.signal,
  });
  assert.equal(client.requests.length, 2, 'page 2 is completed, page 3 is not requested');
  assert.equal(repo.state.saves.length, 2);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.stopReason, 'interrupted');
  assert.equal(repo.state.runs[0].status, 'failed');
  assert.equal(repo.state.runs[0].errorMessage, 'interrupted by user');
  assert.equal(repo.state.runs[0].nextOffset, 20);
});

// ---------- options ----------

test('parseImportOptions defaults: 10 records, page size 1000, start 0', () => {
  assert.deepEqual(parseImportOptions([], {}), {
    help: false, limit: DEFAULT_LIMIT, pageSize: 1000, start: 0, resume: false, fresh: false,
  });
  assert.equal(DEFAULT_LIMIT, 10);
});

test('parseImportOptions reads IMPORT_PAGE_SIZE, and --page-size wins', () => {
  assert.equal(parseImportOptions([], { IMPORT_PAGE_SIZE: '250' }).pageSize, 250);
  assert.equal(parseImportOptions(['--page-size', '50'], { IMPORT_PAGE_SIZE: '250' }).pageSize, 50);
  assert.throws(() => parseImportOptions([], { IMPORT_PAGE_SIZE: '5000' }), UsageError);
});

test('parseImportOptions accepts valid options', () => {
  assert.deepEqual(parseImportOptions(['--limit', '5000', '--page-size', '1000', '--start', '7', '--fresh'], {}), {
    help: false, limit: 5000, pageSize: 1000, start: 7, resume: false, fresh: true,
  });
  assert.equal(parseImportOptions(['--limit=25', '--resume'], {}).resume, true);
  assert.deepEqual(parseImportOptions(['--help'], {}), { help: true });
});

for (const argv of [
  ['--all'],
  ['--limit', '0'],
  ['--limit', '5001'],
  ['--limit', '10.5'],
  ['--limit', 'ten'],
  ['--limit', '-5'],
  ['--page-size', '0'],
  ['--page-size', '1001'],
  ['--start', '-1'],
  ['--resume', '--start', '5'],
  ['--resume', '--fresh'],
  ['extra-positional'],
]) {
  test(`parseImportOptions rejects ${argv.join(' ')}`, () => {
    assert.throws(() => parseImportOptions(argv, {}), UsageError);
  });
}

test('readClientOptions maps .env settings and rejects invalid numbers', () => {
  assert.deepEqual(readClientOptions({ IMPORT_DELAY_MS: '2000', IMPORT_RETRIES: '3', IMPORT_TIMEOUT_MS: '30000' }), {
    baseUrl: undefined, timeoutMs: 30000, retries: 3, delayMs: 2000,
  });
  assert.throws(() => readClientOptions({ IMPORT_DELAY_MS: 'soon' }), UsageError);
});
