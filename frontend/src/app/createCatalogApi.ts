// Composition root of the frontend: the only place that chooses an implementation
// of the CatalogApi port. Switching from the mock to the real API changes nothing
// in React components.
import type { CatalogApi } from '../api/catalogApi';
import { createHttpCatalogApi } from '../api/httpCatalogApi';

export interface CatalogApiSetup {
  api: CatalogApi;
  isDemo: boolean;
}

export async function createCatalogApi(): Promise<CatalogApiSetup> {
  if (import.meta.env.MODE === 'mock') {
    // Loaded on demand, so the demonstration data is not part of a normal build.
    const { createMockCatalogApi } = await import('../mock/mockCatalogApi');
    return { api: createMockCatalogApi(), isDemo: true };
  }
  return { api: createHttpCatalogApi(), isDemo: false };
}
