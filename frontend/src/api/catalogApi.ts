// The port the UI depends on (Dependency Inversion): React code only knows this
// interface. Implementations: the HTTP client (real API) and the development-only
// mock. Each method corresponds to one operationId in openapi.yaml.
import type { CreateWorkRequest, ListWorksQuery, SourceList, Work, WorkPage } from './types';

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface CreateWorkOptions extends RequestOptions {
  /** Makes retries of the same submission safe (see POST /works in openapi.yaml). */
  idempotencyKey?: string;
}

export interface CatalogApi {
  listWorks(query: ListWorksQuery, options?: RequestOptions): Promise<WorkPage>;
  getWork(workId: number, options?: RequestOptions): Promise<Work>;
  createWork(body: CreateWorkRequest, options?: CreateWorkOptions): Promise<Work>;
  listSources(options?: RequestOptions): Promise<SourceList>;
}
