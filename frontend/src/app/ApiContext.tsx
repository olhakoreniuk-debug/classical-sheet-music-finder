// Dependency injection for the UI: components receive the CatalogApi port through
// context and never know whether it is the real HTTP client or the mock.
import { createContext, useContext, type ReactNode } from 'react';
import type { CatalogApi } from '../api/catalogApi';

interface ApiContextValue {
  api: CatalogApi;
  /** True when the app runs on built-in demonstration data. */
  isDemo: boolean;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ api, isDemo, children }: ApiContextValue & { children: ReactNode }) {
  return <ApiContext.Provider value={{ api, isDemo }}>{children}</ApiContext.Provider>;
}

function useApiContext(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error('ApiProvider is missing');
  return value;
}

export function useCatalogApi(): CatalogApi {
  return useApiContext().api;
}

export function useIsDemo(): boolean {
  return useApiContext().isDemo;
}
