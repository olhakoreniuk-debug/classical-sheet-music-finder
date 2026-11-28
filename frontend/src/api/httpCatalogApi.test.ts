import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './apiError';
import { createHttpCatalogApi, toQueryString } from './httpCatalogApi';

function jsonResponse(status: number, body: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } });
}

describe('HTTP catalog API', () => {
  it('sends only defined query parameters to /api/v1/works', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { data: [], page: { limit: 10, offset: 0, total: 0 }, links: { self: '/x', next: null, prev: null } }));
    const api = createHttpCatalogApi({ fetchFn });
    await api.listWorks({ q: 'waltz', limit: 10, offset: 0 });
    expect(fetchFn).toHaveBeenCalledWith('/api/v1/works?q=waltz&limit=10&offset=0', expect.objectContaining({ method: 'GET' }));
    expect(toQueryString({ a: undefined, b: false })).toBe('?b=false');
  });

  it('turns a Problem Details response into an ApiError with field errors', async () => {
    const problem = {
      type: 'https://classical-sheet-music-finder.local/problems/validation',
      title: 'Validation failed',
      status: 422,
      detail: '1 field is invalid.',
      errors: [{ location: 'body', field: '/title', code: 'blank', message: 'Title must not be blank.' }],
    };
    const api = createHttpCatalogApi({ fetchFn: async () => jsonResponse(422, problem, 'application/problem+json') });
    const error = await api.createWork({ title: ' ' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).fieldErrors).toHaveLength(1);
  });

  it('sends JSON and the Idempotency-Key header when creating a work', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(201, {}));
    const api = createHttpCatalogApi({ fetchFn });
    await api.createWork({ title: 'T' }, { idempotencyKey: 'key-1' });
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json', 'Idempotency-Key': 'key-1' });
    expect(init?.body).toBe('{"title":"T"}');
  });

  it('reports an unreachable server as a network error', async () => {
    const api = createHttpCatalogApi({ fetchFn: async () => Promise.reject(new TypeError('Failed to fetch')) });
    const error = await api.listSources().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('network');
  });

  it('falls back to a generic problem when the error body is not Problem Details', async () => {
    const api = createHttpCatalogApi({ fetchFn: async () => new Response('oops', { status: 502, statusText: 'Bad Gateway' }) });
    const error = (await api.getWork(1).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(502);
    expect(error.problem?.title).toBe('Bad Gateway');
  });
});
