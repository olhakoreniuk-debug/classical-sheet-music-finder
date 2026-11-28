// CatalogApi implementation that calls the REST API described in openapi.yaml.
import { ApiError, isAbortError, isProblem } from './apiError';
import type { CatalogApi, CreateWorkOptions, RequestOptions } from './catalogApi';
import type { CreateWorkRequest, ListWorksQuery, Problem, SourceList, Work, WorkPage } from './types';

type FetchFn = typeof fetch;

export interface HttpCatalogApiConfig {
  /** Base URL of the API; relative by default, as in openapi.yaml `servers`. */
  baseUrl?: string;
  fetchFn?: FetchFn;
}

/** Builds a query string from defined values only (the API rejects unknown or empty parameters). */
export function toQueryString(query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) params.set(name, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function readProblem(response: Response): Promise<Problem> {
  const fallback: Problem = {
    type: 'about:blank',
    title: response.statusText || 'Request failed',
    status: response.status,
  };
  try {
    const body: unknown = await response.json();
    return isProblem(body) ? body : fallback;
  } catch {
    return fallback;
  }
}

export function createHttpCatalogApi(config: HttpCatalogApiConfig = {}): CatalogApi {
  const baseUrl = config.baseUrl ?? '/api/v1';
  const fetchFn: FetchFn = config.fetchFn ?? ((input, init) => globalThis.fetch(input, init));

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers: { Accept: 'application/json', ...init.headers },
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw ApiError.network();
    }
    if (!response.ok) throw ApiError.fromProblem(await readProblem(response));
    // The response shape is guaranteed by the contract; the server's contract tests enforce it.
    return (await response.json()) as T;
  }

  const withSignal = (options?: RequestOptions): RequestInit =>
    options?.signal ? { signal: options.signal } : {};

  return {
    listWorks(query: ListWorksQuery, options?: RequestOptions) {
      return request<WorkPage>(`/works${toQueryString(query)}`, { method: 'GET', ...withSignal(options) });
    },

    getWork(workId: number, options?: RequestOptions) {
      return request<Work>(`/works/${encodeURIComponent(String(workId))}`, {
        method: 'GET',
        ...withSignal(options),
      });
    },

    createWork(body: CreateWorkRequest, options?: CreateWorkOptions) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
      return request<Work>('/works', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...withSignal(options),
      });
    },

    listSources(options?: RequestOptions) {
      return request<SourceList>('/sources', { method: 'GET', ...withSignal(options) });
    },
  };
}
