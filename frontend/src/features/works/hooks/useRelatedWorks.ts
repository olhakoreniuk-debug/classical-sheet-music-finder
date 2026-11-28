import { useCatalogApi } from '../../../app/ApiContext';
import type { ListWorksQuery, Work, WorkPage } from '../../../api/types';
import { useAsyncResource, type AsyncResource } from '../../../shared/useAsyncResource';

/** How many related works to show; one extra is requested because the current work may be among them. */
export const RELATED_WORKS_COUNT = 5;

/**
 * Other works by the same composer, using the existing `composer` filter of
 * listWorks. Resolves to null without a request when the work has no composer.
 */
export function useRelatedWorks(work: Work): AsyncResource<Work[] | null> {
  const api = useCatalogApi();
  const composer = work.composer?.name ?? null;
  const query: ListWorksQuery | null = composer ? { composer, sort: 'title', limit: RELATED_WORKS_COUNT + 1 } : null;
  return useAsyncResource(`related:${work.id}:${composer ?? ''}`, async (signal) =>
    query ? otherWorks(await api.listWorks(query, { signal }), work) : null,
  );
}

export function otherWorks(page: WorkPage, current: Work): Work[] {
  return page.data.filter((w) => w.id !== current.id).slice(0, RELATED_WORKS_COUNT);
}
