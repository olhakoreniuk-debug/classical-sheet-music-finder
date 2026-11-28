// IMSLP as a CatalogSource (src/core/ports.js): fetches a raw IMSLP page,
// checks IMSLP's page format, parses it and maps every work to the neutral
// work model. Everything IMSLP-specific (permlinks, metadata.start,
// moreResultsAvailable, IMSLP ids) stays in this adapter (architecture C2, C3).

import { ImportPageError } from '../../core/errors.js';
import { parseWorksPage } from './parser.js';

export const IMSLP_SOURCE_CODE = 'imslp';

// IMSLP's own page checks (moved unchanged from the importer).
function checkImslpPage(page, offset, requestLimit) {
  if (page === null || typeof page !== 'object' || !Array.isArray(page.works) || !page.metadata) {
    throw new ImportPageError('IMSLP client returned an unexpected page shape');
  }
  const reportedStart = Number(page.metadata.start);
  if (reportedStart !== offset) {
    throw new ImportPageError(
      `IMSLP returned a page for start=${page.metadata.start}, but start=${offset} was requested`,
    );
  }
  if (page.works.length > requestLimit) {
    throw new ImportPageError(
      `IMSLP returned ${page.works.length} records, but at most ${requestLimit} were requested`,
    );
  }
  if (page.works.length === 0 && page.metadata.moreResultsAvailable) {
    throw new ImportPageError(
      `IMSLP returned an empty page at offset ${offset} although it reports more results`,
    );
  }
}

/** Parser output -> neutral work. The permlink is both IMSLP's identifier and the page URL. */
export function toNeutralWork(work) {
  return {
    sourceWorkId: work.permlink,
    title: work.title,
    composerName: work.composerName ?? null,
    catalogueNumber: work.catalogueNumber ?? null,
    pageUrl: work.permlink,
    extra: { imslpId: work.imslpId, imslpPageId: work.imslpPageId ?? null, parent: work.parent ?? null },
  };
}

/**
 * @param {{ client: { fetchWorksPage(request: { start: number, limit: number }): Promise<any> },
 *           parsePage?: typeof parseWorksPage }} deps
 * @returns {import('../../core/ports.js').CatalogSource}
 */
export function createImslpSource({ client, parsePage = parseWorksPage }) {
  return {
    code: IMSLP_SOURCE_CODE,
    async fetchPage({ start, limit }) {
      const page = await client.fetchWorksPage({ start, limit });
      checkImslpPage(page, start, limit);
      const { works, skipped } = parsePage(page);
      return {
        works: works.map(toNeutralWork),
        skipped: skipped.map((skip) => ({ index: skip.index, recordId: skip.imslpId ?? null, reason: skip.reason })),
        fetchedCount: page.works.length,
        moreAvailable: Boolean(page.metadata.moreResultsAvailable),
      };
    },
  };
}
