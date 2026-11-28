import { useCatalogApi } from '../../../app/ApiContext';
import { useAsyncResource, type AsyncResource } from '../../../shared/useAsyncResource';
import { loadCatalogueOverview, type CatalogueOverview } from '../model/catalogueOverview';

export function useCatalogueOverview(): AsyncResource<CatalogueOverview> {
  const api = useCatalogApi();
  return useAsyncResource('catalogue-overview', (signal) => loadCatalogueOverview(api, signal));
}
