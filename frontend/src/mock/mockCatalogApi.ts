// DEVELOPMENT-ONLY CatalogApi implementation with in-memory demonstration data.
// It follows the behaviour described in openapi.yaml (filtering, sorting,
// pagination, links, Problem Details errors, idempotency) so the UI behaves the
// same with the mock and with the real API. It is loaded only in "mock" mode.
import { ApiError } from '../api/apiError';
import type { CatalogApi, CreateWorkOptions, RequestOptions } from '../api/catalogApi';
import { toQueryString } from '../api/httpCatalogApi';
import type { Composer, CreateWorkRequest, ListWorksQuery, Problem, Source, SourceList, Work, WorkPage, WorkSort } from '../api/types';
import { demoSources, demoWorks } from './demoData';
import { comparableUrl, validateCreateWork } from './mockValidation';

const PROBLEM_BASE = 'https://classical-sheet-music-finder.local/problems';

export interface MockCatalogApiConfig {
  /** Simulated network latency in milliseconds. */
  delayMs?: number;
  works?: readonly Work[];
  sources?: readonly Source[];
  /** Simulates ADR-0003's write switch. */
  writesEnabled?: boolean;
}

function problem(status: number, slug: string, title: string, detail: string, instance: string, errors?: Problem['errors']): ApiError {
  const body: Problem = { type: `${PROBLEM_BASE}/${slug}`, title, status, detail, instance };
  if (errors) body.errors = errors;
  return ApiError.fromProblem(body);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function compareWorks(sort: WorkSort): (a: Work, b: Work) => number {
  const byId = (a: Work, b: Work) => a.id - b.id;
  switch (sort) {
    case 'title':
      return (a, b) => collator.compare(a.title, b.title) || byId(a, b);
    case '-title':
      return (a, b) => collator.compare(b.title, a.title) || byId(a, b);
    case 'createdAt':
      return (a, b) => a.createdAt.localeCompare(b.createdAt) || byId(a, b);
    case '-createdAt':
      return (a, b) => b.createdAt.localeCompare(a.createdAt) || byId(a, b);
  }
}

export function createMockCatalogApi(config: MockCatalogApiConfig = {}): CatalogApi {
  const delayMs = config.delayMs ?? 350;
  const writesEnabled = config.writesEnabled ?? true;
  const works: Work[] = [...(config.works ?? demoWorks)];
  const sources: Source[] = [...(config.sources ?? demoSources)];
  const composers = new Map<string, Composer>();
  for (const work of works) if (work.composer) composers.set(work.composer.name, work.composer);
  const idempotency = new Map<string, { body: string; work: Work }>();
  let nextWorkId = Math.max(0, ...works.map((w) => w.id)) + 1;
  let nextComposerId = Math.max(0, ...[...composers.values()].map((c) => c.id)) + 1;

  function listWorksSync(query: ListWorksQuery): WorkPage {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const sort = query.sort ?? 'title';
    const instance = `/api/v1/works${toQueryString(query)}`;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw problem(400, 'invalid-parameter', 'Invalid request parameter', 'One or more parameters are invalid.', instance, [
        { location: 'query', field: 'limit', code: 'out_of_range', message: 'limit must be between 1 and 100.' },
      ]);
    }
    const q = query.q?.toLowerCase();
    const composer = query.composer?.toLowerCase();
    const matches = works
      .filter((w) => (q ? w.title.toLowerCase().includes(q) : true))
      .filter((w) => (composer ? (w.composer?.name.toLowerCase().includes(composer) ?? false) : true))
      .filter((w) => (query.hasCatalogueNumber === undefined ? true : (w.catalogueNumber !== null) === query.hasCatalogueNumber))
      .filter((w) => (query.source ? w.source.code === query.source : true))
      .sort(compareWorks(sort));

    const link = (pageOffset: number) =>
      `/api/v1/works${toQueryString({ q: query.q, composer: query.composer, hasCatalogueNumber: query.hasCatalogueNumber, source: query.source, sort, limit, offset: pageOffset })}`;

    return {
      data: matches.slice(offset, offset + limit),
      page: { limit, offset, total: matches.length },
      links: {
        self: link(offset),
        next: offset + limit < matches.length ? link(offset + limit) : null,
        prev: offset > 0 ? link(Math.max(0, offset - limit)) : null,
      },
    };
  }

  function createWorkSync(body: CreateWorkRequest, idempotencyKey?: string): Work {
    const instance = '/api/v1/works';
    if (!writesEnabled) {
      throw problem(403, 'writes-disabled', 'Writes are disabled', 'This server does not accept changes.', instance);
    }
    const bodyText = JSON.stringify(body);
    if (idempotencyKey) {
      const earlier = idempotency.get(idempotencyKey);
      if (earlier && earlier.body === bodyText) return earlier.work;
      if (earlier) {
        throw problem(422, 'validation', 'Validation failed', 'This Idempotency-Key was used with a different body.', instance, [
          { location: 'header', field: 'Idempotency-Key', code: 'idempotency_key_reused', message: 'Use a new key for a different request.' },
        ]);
      }
    }
    const result = validateCreateWork(body);
    if (!result.ok) {
      const count = result.errors.length;
      throw problem(422, 'validation', 'Validation failed', `${count} ${count === 1 ? 'field is' : 'fields are'} invalid.`, instance, result.errors);
    }
    const { value } = result;
    if (value.pageUrl !== null) {
      const wanted = comparableUrl(value.pageUrl);
      const existing = works.find((w) => w.pageUrl !== null && comparableUrl(w.pageUrl) === wanted);
      if (existing) {
        throw problem(409, 'duplicate-work', 'Work already exists', `Work ${existing.id} already has this pageUrl.`, instance);
      }
    }
    let composer: Composer | null = null;
    if (value.composerName !== null) {
      composer = composers.get(value.composerName) ?? { id: nextComposerId++, name: value.composerName };
      composers.set(composer.name, composer);
    }
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const work: Work = {
      id: nextWorkId++,
      title: value.title,
      composer,
      catalogueNumber: value.catalogueNumber,
      pageUrl: value.pageUrl === null ? null : encodeURI(decodeURI(value.pageUrl)),
      source: { code: 'manual', name: 'Added manually' },
      sourceRecordId: crypto.randomUUID(),
      attribution: null,
      createdAt: now,
      updatedAt: now,
    };
    works.push(work);
    if (idempotencyKey) idempotency.set(idempotencyKey, { body: bodyText, work });
    return work;
  }

  return {
    async listWorks(query: ListWorksQuery, options?: RequestOptions) {
      await delay(delayMs, options?.signal);
      return listWorksSync(query);
    },

    async getWork(workId: number, options?: RequestOptions) {
      await delay(delayMs, options?.signal);
      const work = works.find((w) => w.id === workId);
      if (!work) {
        throw problem(404, 'not-found', 'Work not found', `There is no work with id ${workId}.`, `/api/v1/works/${workId}`);
      }
      return work;
    },

    async createWork(body: CreateWorkRequest, options?: CreateWorkOptions) {
      await delay(delayMs, options?.signal);
      return createWorkSync(body, options?.idempotencyKey);
    },

    async listSources(options?: RequestOptions): Promise<SourceList> {
      await delay(Math.min(delayMs, 150), options?.signal);
      return { data: [...sources].sort((a, b) => collator.compare(a.name, b.name)) };
    },
  };
}
