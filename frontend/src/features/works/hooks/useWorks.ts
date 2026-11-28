import { useCatalogApi } from '../../../app/ApiContext';
import type { ListWorksQuery, WorkPage } from '../../../api/types';
import { useAsyncResource, type AsyncResource } from '../../../shared/useAsyncResource';

export function useWorks(query: ListWorksQuery): AsyncResource<WorkPage> {
  const api = useCatalogApi();
  return useAsyncResource(JSON.stringify(query), (signal) => api.listWorks(query, { signal }));
}
