// API integration tests (ADR-0004): the real Express app, core use cases and
// PostgreSQL adapters on a temporary schema, called over HTTP with fetch.
// Every response body is validated against openapi.yaml.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createPostgresSourceQueries, createPostgresWorkCommands, createPostgresWorkQueries } from '../../src/adapters/postgres/catalogRepository.js';
import { createPostgresRepository } from '../../src/adapters/postgres/repository.js';
import { createWork } from '../../src/core/catalog/createWork.js';
import { getWork } from '../../src/core/catalog/getWork.js';
import { listSources } from '../../src/core/catalog/listSources.js';
import { listWorks } from '../../src/core/catalog/listWorks.js';
import { loadContract } from '../../src/web/contract.js';
import { createApp } from '../../src/web/createApp.js';
import { createIdempotencyStore } from '../../src/web/idempotency.js';
import { createTestSchema } from './testSchema.js';

let db;
let server;
let base;
let origin;
let contract;
const config = { writesEnabled: true, allowedOrigins: [] };

before(async () => {
  db = await createTestSchema();
  contract = await loadContract(new URL('../../openapi.yaml', import.meta.url));
  const ports = {
    workQueries: createPostgresWorkQueries(db.pool),
    workCommands: createPostgresWorkCommands(db.pool),
    sourceQueries: createPostgresSourceQueries(db.pool),
  };
  const app = createApp({
    useCases: {
      listWorks: (c) => listWorks(ports, c),
      getWork: (id) => getWork(ports, id),
      createWork: (input) => createWork(ports, input),
      listSources: () => listSources(ports),
    },
    contract,
    idempotency: createIdempotencyStore(),
    config,
    logger: { error: () => undefined },
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  base = `${origin}/api/v1`;
  config.allowedOrigins.push(origin); // the port is known only after listen()
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await db?.drop();
});

beforeEach(async () => {
  await db.truncateAll();
});

const imslp = (n, title, composer, cat = null) => ({
  sourceWorkId: `https://imslp.org/wiki/"${title}"_(${composer})`,
  title, composerName: composer, catalogueNumber: cat,
  pageUrl: `https://imslp.org/wiki/"${title}"_(${composer})`,
  extra: { imslpId: `${title} (${composer})`, imslpPageId: n, parent: null },
});

async function seedImslp() {
  const repo = createPostgresRepository(db.pool);
  const run = await repo.startImportRun({ sourceCode: 'imslp' });
  await repo.savePage({
    runId: run.id, pageStart: 0, fetchedCount: 3, finish: true,
    works: [
      imslp(1, 'A', 'Ferrari, Carlotta', 'ICF 1237'),
      imslp(2, 'Amicizia', 'Stankovych, Tatiana'),
      imslp(3, 'Wiegenlied', 'Brahms, Johannes', 'Op.49 No.4'),
    ],
  });
}

/** fetch + parse + contract validation of the body. */
async function call(path, { schema, ...init } = {}) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  const expected = schema ?? (response.ok ? null : 'Problem');
  if (expected) assert.deepEqual(contract.validateResponse(expected, body), [], `${path} response matches ${expected}`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'), null, 'no CORS headers');
  if (!response.ok) assert.match(response.headers.get('content-type'), /^application\/problem\+json/);
  return { status: response.status, headers: response.headers, body };
}

const post = (body, headers = {}) => call('/works', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  schema: undefined,
});

test('GET /sources returns the sources ordered by name', async () => {
  const { status, body } = await call('/sources', { schema: 'SourceList' });
  assert.equal(status, 200);
  assert.deepEqual(body.data.map((s) => s.code), ['manual', 'imslp']);
  assert.equal((await call('/sources?x=1')).status, 400);
});

test('GET /works lists, filters, paginates with links and total, and encodes page URLs', async () => {
  await seedImslp();
  const first = await call('/works?limit=2', { schema: 'WorkPage' });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.page, { limit: 2, offset: 0, total: 3 });
  assert.equal(first.body.links.self, '/api/v1/works?sort=title&limit=2&offset=0');
  assert.equal(first.body.links.next, '/api/v1/works?sort=title&limit=2&offset=2');
  assert.equal(first.body.links.prev, null);
  const work = first.body.data[0];
  assert.equal(work.pageUrl, encodeURI(work.sourceRecordId));
  assert.match(work.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
  assert.equal(work.attribution, 'Data from IMSLP, the Petrucci Music Library (imslp.org).');

  const second = await call(first.body.links.next.replace('/api/v1', ''), { schema: 'WorkPage' });
  assert.equal(second.body.data.length, 1);
  assert.equal(second.body.links.next, null);
  assert.equal(second.body.links.prev, '/api/v1/works?sort=title&limit=2&offset=0');

  const filtered = await call('/works?composer=brahms&hasCatalogueNumber=true&source=imslp', { schema: 'WorkPage' });
  assert.deepEqual(filtered.body.data.map((w) => w.title), ['Wiegenlied']);
  assert.equal(filtered.body.links.self, '/api/v1/works?composer=brahms&hasCatalogueNumber=true&source=imslp&sort=title&limit=20&offset=0');
  assert.deepEqual((await call('/works?source=nope', { schema: 'WorkPage' })).body.page.total, 0);
  const desc = await call('/works?sort=-title', { schema: 'WorkPage' });
  assert.deepEqual(desc.body.data.map((w) => w.title), [...(await call('/works')).body.data.map((w) => w.title)].reverse());
});

test('GET /works rejects invalid and unknown parameters with 400 and field errors', async () => {
  const bad = await call('/works?limit=500&sort=id&foo=1');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.type, 'https://classical-sheet-music-finder.local/problems/invalid-parameter');
  assert.deepEqual(bad.body.errors.map((e) => [e.field, e.code]).sort(), [['foo', 'unknown_parameter'], ['limit', 'out_of_range'], ['sort', 'invalid_value']]);
  assert.equal((await call('/works?q=')).status, 400);
  assert.equal((await call('/works?q=a&q=b')).status, 400);
  assert.equal((await call('/works?hasCatalogueNumber=maybe')).status, 400);
  assert.equal((await call('/works?offset=-1')).status, 400);
});

test('GET /works/:workId returns a work, 404 for an unknown id and 400 for an invalid id', async () => {
  await seedImslp();
  const id = (await call('/works')).body.data[0].id;
  const found = await call(`/works/${id}`, { schema: 'Work' });
  assert.equal(found.status, 200);
  assert.equal(found.body.id, id);
  const missing = await call('/works/999999');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.detail, 'There is no work with id 999999.');
  assert.equal(missing.body.instance, '/api/v1/works/999999');
  for (const raw of ['abc', '0', '3.0', '-1']) assert.equal((await call(`/works/${raw}`)).status, 400, raw);
});

test('POST /works creates a manual work (201, Location) and rejects a duplicate page URL (409)', async () => {
  await seedImslp();
  const created = await post({ title: '  Erlkönig ', composerName: 'Schubert, Franz', catalogueNumber: 'D.328', pageUrl: 'https://example.org/erlkoenig' });
  assert.equal(created.status, 201);
  assert.deepEqual(contract.validateResponse('Work', created.body), []);
  assert.equal(created.headers.get('location'), `/api/v1/works/${created.body.id}`);
  assert.equal(created.body.title, 'Erlkönig');
  assert.deepEqual(created.body.source, { code: 'manual', name: 'Added manually' });
  assert.equal(created.body.attribution, null);
  assert.equal((await call(`/works/${created.body.id}`, { schema: 'Work' })).body.title, 'Erlkönig');

  const minimal = await post({ title: 'Untitled song' });
  assert.equal(minimal.status, 201);
  assert.equal(minimal.body.composer, null);
  assert.equal(minimal.body.pageUrl, null);

  // The encoded form of the imported page URL is the same page (ADR-0002).
  const duplicate = await post({ title: 'Copy', pageUrl: 'https://imslp.org/wiki/%22A%22_(Ferrari,%20Carlotta)' });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.type, 'https://classical-sheet-music-finder.local/problems/duplicate-work');
});

test('POST /works validation and request rules: 422, 400, 413, 415', async () => {
  const invalid = await post({ title: '   ', pageUrl: 'ftp://x', extra: 1 });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.errors.map((e) => [e.field, e.code]).sort(), [['/extra', 'unknown_field'], ['/pageUrl', 'invalid_format'], ['/title', 'blank']]);
  assert.equal((await post({})).body.errors[0].code, 'required');
  assert.equal((await post('"just a string"')).status, 422);
  assert.equal((await post('{"title": ')).status, 400);
  assert.equal((await post({ title: 'x'.repeat(17 * 1024) })).status, 413);
  const wrongType = await call('/works', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: origin }, body: '{}' });
  assert.equal(wrongType.status, 415);
  assert.equal((await post({ title: 'a' }, { 'Idempotency-Key': 'has space' })).status, 400);
  const withQuery = await call('/works?x=1', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{"title":"a"}' });
  assert.equal(withQuery.status, 400);
  assert.equal(withQuery.body.type, 'https://classical-sheet-music-finder.local/problems/malformed-request');
});

test('POST /works requires an allowed Origin (403) and nothing is created', async () => {
  const noOrigin = await call('/works', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":"a"}' });
  assert.equal(noOrigin.status, 403);
  const foreign = await post({ title: 'a' }, { Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await call('/works', { schema: 'WorkPage' })).body.page.total, 0);
});

test('POST /works with Idempotency-Key replays the 201 and rejects a different body', async () => {
  const key = 'f1a5a9b2-7c1d-4e0f-9a6b-0c1d2e3f4a5b';
  const first = await post({ title: 'Ständchen', composerName: 'Schubert, Franz' }, { 'Idempotency-Key': key });
  assert.equal(first.status, 201);
  assert.equal(first.headers.get('idempotent-replayed'), null);
  const replay = await post({ composerName: 'Schubert, Franz', title: 'Ständchen ' }, { 'Idempotency-Key': key });
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.headers.get('location'), first.headers.get('location'));
  const reused = await post({ title: 'Other' }, { 'Idempotency-Key': key });
  assert.equal(reused.status, 422);
  assert.equal(reused.body.errors[0].code, 'idempotency_key_reused');
  assert.equal((await call('/works', { schema: 'WorkPage' })).body.page.total, 1);
});

test('unknown paths and methods return Problem Details', async () => {
  assert.equal((await call('/nothing')).status, 404);
  assert.equal((await call('/works/1', { method: 'DELETE' })).status, 405);
});

test('POST /works is refused with 403 when writes are disabled', async () => {
  config.writesEnabled = false;
  try {
    const refused = await post({ title: 'a' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.type, 'https://classical-sheet-music-finder.local/problems/writes-disabled');
  } finally {
    config.writesEnabled = true;
  }
});
