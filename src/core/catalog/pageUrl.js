// Page URL comparison key (ADR-0002 §4): two page URLs are the same work page
// when they are equal after trimming and percent-decoding, so the encoded and
// unencoded forms of an IMSLP permlink match. Pure function.

/** @returns {string | null} the comparison key, or null for no URL */
export function pageUrlKey(url) {
  if (url === null || url === undefined) return null;
  const trimmed = String(url).trim();
  if (trimmed === '') return null;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed; // malformed escapes: compare the text as it is
  }
}
