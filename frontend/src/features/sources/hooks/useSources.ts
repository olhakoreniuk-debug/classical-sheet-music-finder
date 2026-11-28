import { useCatalogApi } from '../../../app/ApiContext';
import type { SourceList } from '../../../api/types';
import { useAsyncResource, type AsyncResource } from '../../../shared/useAsyncResource';

/** All sources from GET /sources; nothing about individual providers is hard-coded. */
export function useSources(): AsyncResource<SourceList> {
  const api = useCatalogApi();
  return useAsyncResource('sources', (signal) => api.listSources({ signal }));
}
