import { useCatalogApi } from '../../../app/ApiContext';
import type { Work } from '../../../api/types';
import { useAsyncResource, type AsyncResource } from '../../../shared/useAsyncResource';

export function useWork(workId: number): AsyncResource<Work> {
  const api = useCatalogApi();
  return useAsyncResource(String(workId), (signal) => api.getWork(workId, { signal }));
}
