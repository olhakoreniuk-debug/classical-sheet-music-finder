// Offline API tests with fake use cases (no database): concurrency of
// Idempotency-Key and the generic 500 that reveals nothing.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadContract } from '../src/web/contract.js';
import { createApp } from '../src/web/createApp.js';
import { createIdempotencyStore } from '../src/web/idempotency.js';
import { encodePageUrl } from '../src/web/workMapper.js';

let server;
let base;
let origin;
let releaseCreate;
const config = { writesEnabled: true, allowedOrigins: [] };
const logged = [];

const work = {
  id: 42, title: 'Erlkönig', composer: null, catalogueNumber: null, pageUrl: null,
  source: { code: 'manual', name: 'Added manually' }, sourceRecordId: 'uuid', attribution: null,
  createdAt: new Date('2026-12-01T10:00:00Z'), updatedAt: new Date('2026-12-01T10:00:00Z'),
};

before(async () => {
  const app = createApp({
    useCases: {
      listWorks: async () => { throw new Error('secret SQL detail'); },
      getWork: async () => work,
      createWork: () => new Promise((resolve) => { releaseCreate = () => resolve(work); }),
      listSources: async () => [],
    },
    contract: await loadContract(new URL('../openapi.yaml', import.meta.url)),
    idempotency: createIdempotencyStore(),
    config,
    logger: { error: (message) => logged.push(message) },
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  base = `${origin}/api/v1`;
  config.allowedOrigins.push(origin);
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

test('a repeat while the first request with the same key is still running gets 409', async () => {
  const send = () => fetch(`${base}/works`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'Idempotency-Key': 'k-1' },
    body: JSON.stringify({ title: 'Erlkönig' }),
  });
  const first = send();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = await send();
  assert.equal(second.status, 409);
  assert.equal((await second.json()).type, 'https://classical-sheet-music-finder.local/problems/idempotency-in-progress');
  releaseCreate();
  assert.equal((await first).status, 201);
});

test('an unexpected error becomes a generic 500 without details; the server logs it', async () => {
  const response = await fetch(`${base}/works`);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, { type: 'about:blank', title: 'Internal Server Error', status: 500, instance: '/api/v1/works' });
  assert.match(logged.at(-1), /secret SQL detail/);
});

test('encodePageUrl encodes characters URIs do not allow, without double-encoding', () => {
  assert.equal(encodePageUrl('https://imslp.org/wiki/"A"_(Ferrari,_Carlotta)'), 'https://imslp.org/wiki/%22A%22_(Ferrari,_Carlotta)');
  assert.equal(encodePageUrl('https://example.org/%C3%A9'), 'https://example.org/%C3%A9');
  assert.equal(encodePageUrl('https://example.org/é'), 'https://example.org/%C3%A9');
  assert.equal(encodePageUrl(null), null);
});
