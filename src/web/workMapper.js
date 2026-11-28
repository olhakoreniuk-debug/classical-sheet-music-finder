// Domain objects (src/core/ports.js) -> API shapes (openapi.yaml). Every
// nullable property is always present.

/**
 * pageUrl as a valid URI reference: characters that are not allowed in a URI
 * (e.g. the quotes in IMSLP permlinks) are percent-encoded; existing escapes
 * are kept, so an already encoded URL is not encoded twice.
 */
export function encodePageUrl(url) {
  if (url === null) return null;
  try {
    return encodeURI(decodeURI(url));
  } catch {
    return encodeURI(url); // malformed escapes: encode the text as it is
  }
}

/** RFC 3339 in UTC, without fractional seconds when they are zero. */
export function toTimestamp(date) {
  return new Date(date).toISOString().replace('.000Z', 'Z');
}

/** @param {import('../core/ports.js').Work} work */
export function toApiWork(work) {
  return {
    id: work.id,
    title: work.title,
    composer: work.composer ? { id: work.composer.id, name: work.composer.name } : null,
    catalogueNumber: work.catalogueNumber,
    pageUrl: encodePageUrl(work.pageUrl),
    source: { code: work.source.code, name: work.source.name },
    sourceRecordId: work.sourceRecordId,
    attribution: work.attribution,
    createdAt: toTimestamp(work.createdAt),
    updatedAt: toTimestamp(work.updatedAt),
  };
}

/** @param {import('../core/ports.js').Source} source */
export function toApiSource(source) {
  return {
    code: source.code,
    name: source.name,
    kind: source.kind,
    homepageUrl: source.homepageUrl,
    attribution: source.attribution,
    metadataLicence: source.metadataLicence,
  };
}
