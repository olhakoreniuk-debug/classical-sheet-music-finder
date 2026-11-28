// IMSLP data parser.
//
// Turns one page of raw IMSLP work records (as returned by
// imslpClient.fetchWorksPage) into clean objects that match the database
// schema. Pure functions only: no network, no database, no imports from the
// API client or the repository layer.
//
// Rules:
//   - Required fields (permlink, id, title): if missing or invalid, the record
//     is skipped with a reason and the rest of the page is still processed.
//   - Optional fields (composer, catalogue number, page id, parent): if
//     missing, empty or invalid, the field becomes null and the record is kept.
//   - Strings are only trimmed. No Unicode normalization, no other changes,
//     so accents and non-Latin text are stored exactly as IMSLP sends them.

const WORK_TYPE = '2'; // the API is queried with type=2 (works)
const ALLOWED_HOST = 'imslp.org';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMissing(value) {
  return value === undefined || value === null;
}

// Trimmed string, or null if the value is not a string or is blank.
function cleanString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Reads a required string field.
// Returns { value } or { reason } with "missing <name>" / "invalid <name>".
function requiredString(value, name) {
  if (isMissing(value)) return { reason: `missing ${name}` };
  if (typeof value !== 'string') return { reason: `invalid ${name}: not a string` };
  const cleaned = cleanString(value);
  if (cleaned === null) return { reason: `missing ${name}` };
  return { value: cleaned };
}

// True if the URL is http(s) on imslp.org or a subdomain of it.
function isImslpUrl(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname; // already lower-cased by URL
  return host === ALLOWED_HOST || host.endsWith(`.${ALLOWED_HOST}`);
}

// IMSLP page id: a string of digits -> positive safe integer, otherwise null.
export function parsePageId(value) {
  const text = cleanString(value);
  if (text === null || !/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// Unix seconds (number or digit string) -> UTC Date, otherwise null.
export function parseTimestamp(value) {
  let seconds;
  if (typeof value === 'number') {
    seconds = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    seconds = Number(value.trim());
  } else {
    return null;
  }
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Parses one raw work record.
// Returns { ok: true, work } or { ok: false, reason }.
export function parseWork(raw) {
  if (!isPlainObject(raw)) return { ok: false, reason: 'record is not an object' };

  // type is optional, but if present it must be "2".
  if (!isMissing(raw.type) && cleanString(raw.type) !== WORK_TYPE) {
    return { ok: false, reason: `unexpected type: ${JSON.stringify(raw.type)}` };
  }

  const permlink = requiredString(raw.permlink, 'permlink');
  if (permlink.reason) return { ok: false, reason: permlink.reason };
  if (!isImslpUrl(permlink.value)) {
    return { ok: false, reason: 'invalid permlink: not an http(s) imslp.org URL' };
  }

  const imslpId = requiredString(raw.id, 'id');
  if (imslpId.reason) return { ok: false, reason: imslpId.reason };

  if (isMissing(raw.intvals)) return { ok: false, reason: 'missing intvals' };
  if (!isPlainObject(raw.intvals)) return { ok: false, reason: 'invalid intvals: not an object' };
  const intvals = raw.intvals;

  const title = requiredString(intvals.worktitle, 'title');
  if (title.reason) return { ok: false, reason: title.reason };

  return {
    ok: true,
    work: {
      imslpId: imslpId.value,
      title: title.value,
      composerName: cleanString(intvals.composer),
      catalogueNumber: cleanString(intvals.icatno),
      imslpPageId: parsePageId(intvals.pageid),
      parent: cleanString(raw.parent),
      permlink: permlink.value,
    },
  };
}

// Parses a page from fetchWorksPage: { works: [...raw], metadata: {...} }.
// Returns { works, skipped, meta }. Never throws because of a bad record;
// throws TypeError only if the page itself has the wrong shape.
export function parseWorksPage(page) {
  if (!isPlainObject(page) || !Array.isArray(page.works)) {
    throw new TypeError('parseWorksPage expects { works: [...], metadata: {...} }');
  }

  const works = [];
  const skipped = [];
  const seenPermlinks = new Set();

  page.works.forEach((raw, index) => {
    const imslpId = isPlainObject(raw) ? cleanString(raw.id) : null;
    const result = parseWork(raw);

    if (!result.ok) {
      skipped.push({ index, imslpId, reason: result.reason });
      return;
    }
    // A multi-row INSERT ... ON CONFLICT cannot touch the same key twice.
    if (seenPermlinks.has(result.work.permlink)) {
      skipped.push({ index, imslpId, reason: 'duplicate permlink in page' });
      return;
    }
    seenPermlinks.add(result.work.permlink);
    works.push(result.work);
  });

  const metadata = isPlainObject(page.metadata) ? page.metadata : {};
  const meta = {
    start: metadata.start,
    limit: metadata.limit,
    moreResultsAvailable: metadata.moreResultsAvailable,
    fetchedAt: parseTimestamp(metadata.timestamp),
  };

  return { works, skipped, meta };
}
