import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/apiError';
import { makeWork, manualSource, sourceA } from '../test/fixtures';
import { createMockCatalogApi } from './mockCatalogApi';

const works = [
  makeWork(1, { title: 'Waltz in A', createdAt: '2026-01-01T00:00:00Z' }),
  makeWork(2, { title: 'Sonata', catalogueNumber: null, composer: null, createdAt: '2026-02-01T00:00:00Z' }),
  makeWork(3, { title: 'Another Waltz', createdAt: '2026-03-01T00:00:00Z' }),
];
const api = () => createMockCatalogApi({ delayMs: 0, works, sources: [sourceA, manualSource] });

describe('mock catalog API (behaves like openapi.yaml)', () => {
  it('filters, sorts and paginates with links', async () => {
    const page = await api().listWorks({ q: 'waltz', sort: 'title', limit: 1, offset: 0 });
    expect(page.page).toEqual({ limit: 1, offset: 0, total: 2 });
    expect(page.data.map((w) => w.id)).toEqual([3]);
    expect(page.links.prev).toBeNull();
    expect(page.links.next).toContain('offset=1');
  });

  it('filters by catalogue number presence and source code', async () => {
    const without = await api().listWorks({ hasCatalogueNumber: false });
    expect(without.data.map((w) => w.id)).toEqual([2]);
    const unknownSource = await api().listWorks({ source: 'nowhere' });
    expect(unknownSource.page.total).toBe(0);
  });

  it('returns 404 Problem Details for an unknown work', async () => {
    const error = (await api().getWork(999).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
  });

  it('validates new works like the contract (422 with field errors)', async () => {
    const error = (await api()
      .createWork({ title: '   ', pageUrl: 'ftp://x' })
      .catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(422);
    expect(error.fieldErrors.map((e) => `${e.field}:${e.code}`)).toEqual(['/title:blank', '/pageUrl:invalid_format']);
  });

  it('creates a manual work, reuses composers and rejects duplicate page URLs (409)', async () => {
    const instance = api();
    const created = await instance.createWork({ title: ' New ', composerName: 'Composer 1', pageUrl: 'https://n.example/1' });
    expect(created.title).toBe('New');
    expect(created.source.code).toBe('manual');
    expect(created.attribution).toBeNull();
    expect(created.composer?.id).toBe(101);
    const duplicate = (await instance.createWork({ title: 'Other', pageUrl: 'https://a.example/works/1' }).catch((e: unknown) => e)) as ApiError;
    expect(duplicate.status).toBe(409);
  });

  it('replays an idempotent request and rejects a reused key with a different body', async () => {
    const instance = api();
    const first = await instance.createWork({ title: 'Same' }, { idempotencyKey: 'k1' });
    const again = await instance.createWork({ title: 'Same' }, { idempotencyKey: 'k1' });
    expect(again.id).toBe(first.id);
    const reused = (await instance.createWork({ title: 'Different' }, { idempotencyKey: 'k1' }).catch((e: unknown) => e)) as ApiError;
    expect(reused.status).toBe(422);
  });

  it('returns 403 when writes are disabled', async () => {
    const instance = createMockCatalogApi({ delayMs: 0, works, writesEnabled: false });
    const error = (await instance.createWork({ title: 'X' }).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(403);
  });

  it('lists sources sorted by name', async () => {
    const list = await api().listSources();
    expect(list.data.map((s) => s.name)).toEqual(['Added manually', 'Source A']);
  });
});
