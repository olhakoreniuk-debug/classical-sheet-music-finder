// IMSLP API client.
//
// Fetches one page of works from the IMSLP "worklist" API and returns the raw
// work records plus pagination metadata. It does NOT parse or clean individual
// records (that is the parser's job) and it does NOT touch the database.
//
// Reliability features:
//   - timeout per request (AbortSignal.timeout)
//   - retries with exponential backoff for network errors, timeouts, 429 and 5xx
//   - a minimum delay between requests (IMSLP robots.txt: Crawl-delay: 2)
//   - detection of IMSLP application errors (HTTP 200 with a JSON string body)

const DEFAULTS = {
  baseUrl: 'https://imslp.org/imslpscripts/API.ISCR.php',
  timeoutMs: 30_000, // give up on a single request after 30 s
  retries: 3, // retries after the first attempt (4 attempts in total)
  delayMs: 2_000, // minimum time between request starts; also the backoff base
  maxBackoffMs: 60_000, // never wait longer than this before a retry
};

export const MAX_LIMIT = 1000; // largest page size IMSLP accepts

// An error from the IMSLP client. `retryable` tells the retry loop whether
// trying again could help (e.g. HTTP 503) or not (e.g. HTTP 404).
export class ImslpApiError extends Error {
  constructor(message, { retryable = false, status, retryAfterMs, cause } = {}) {
    super(message, { cause });
    this.name = 'ImslpApiError';
    this.retryable = retryable;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Builds the works URL. IMSLP parameters are separated by "/", not "&".
export function buildWorksUrl({ start, limit }, baseUrl = DEFAULTS.baseUrl) {
  if (!Number.isInteger(start) || start < 0) {
    throw new RangeError(`start must be an integer >= 0, got ${start}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`limit must be an integer from 1 to ${MAX_LIMIT}, got ${limit}`);
  }
  const params = [
    'account=worklist',
    'disclaimer=accepted',
    'sort=id',
    'type=2',
    `start=${start}`,
    `limit=${limit}`,
    'retformat=json',
  ];
  return `${baseUrl}?${params.join('/')}`;
}

// Checks the overall shape of a parsed response and splits it into works and
// metadata. Individual work records are passed through unchanged, even if one
// looks malformed: record-level validation belongs to the parser.
export function validateWorksResponse(body) {
  // IMSLP reports application errors as HTTP 200 with a JSON string body.
  if (typeof body === 'string') {
    throw new ImslpApiError(`IMSLP API error: ${body}`);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ImslpApiError('Unexpected response: expected a JSON object');
  }

  const meta = body.metadata;
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new ImslpApiError('Unexpected response: missing "metadata" object');
  }
  if (typeof meta.moreresultsavailable !== 'boolean') {
    throw new ImslpApiError('Unexpected response: "metadata.moreresultsavailable" is not a boolean');
  }

  // Works are stored under the keys "0", "1", ... "n". Sort them numerically
  // so "10" comes after "9", not after "1".
  const works = Object.keys(body)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => body[key]);

  return {
    works,
    metadata: {
      start: meta.start,
      limit: meta.limit,
      moreResultsAvailable: meta.moreresultsavailable,
      timestamp: meta.timestamp, // Unix seconds
    },
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

// Reads a numeric "Retry-After" header (seconds) and returns milliseconds.
function parseRetryAfterMs(response) {
  const value = response.headers.get('retry-after');
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim()) * 1000;
}

// Removes undefined values so they do not overwrite the defaults.
function withoutUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function checkNonNegativeNumber(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a number >= 0, got ${value}`);
  }
}

// Creates a client with its own settings and its own crawl-delay timer.
//
// Options: baseUrl, timeoutMs, retries, delayMs, maxBackoffMs.
// For tests: fetchFn, sleepFn, nowFn and log can be replaced with fakes.
export function createImslpClient(options = {}) {
  const config = { ...DEFAULTS, ...withoutUndefined(options) };
  for (const name of ['timeoutMs', 'retries', 'delayMs', 'maxBackoffMs']) {
    checkNonNegativeNumber(name, config[name]);
  }

  const fetchFn = config.fetchFn ?? globalThis.fetch;
  const sleepFn = config.sleepFn ?? sleep;
  const nowFn = config.nowFn ?? Date.now;
  const log = config.log ?? console.warn;

  let lastRequestStartedAt = null;

  // Waits until at least `delayMs` has passed since the previous request started.
  async function waitForCrawlDelay() {
    if (lastRequestStartedAt !== null) {
      const waitMs = lastRequestStartedAt + config.delayMs - nowFn();
      if (waitMs > 0) await sleepFn(waitMs);
    }
    lastRequestStartedAt = nowFn();
  }

  // Backoff before retry number n (1, 2, 3...): delayMs, 2x, 4x...
  // A longer Retry-After from the server wins. Capped at maxBackoffMs.
  function backoffMs(retryNumber, error) {
    let waitMs = config.delayMs * 2 ** (retryNumber - 1);
    if (error.retryAfterMs !== undefined) waitMs = Math.max(waitMs, error.retryAfterMs);
    return Math.min(waitMs, config.maxBackoffMs);
  }

  // One HTTP attempt: request, status check, JSON parse, structure check.
  async function attemptRequest(url) {
    let text;
    try {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(config.timeoutMs) });
      if (!response.ok) {
        throw new ImslpApiError(`HTTP ${response.status}`, {
          status: response.status,
          retryable: isRetryableStatus(response.status),
          retryAfterMs: parseRetryAfterMs(response),
        });
      }
      text = await response.text(); // also covered by the timeout signal
    } catch (error) {
      if (error instanceof ImslpApiError) throw error;
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new ImslpApiError(`Request timed out after ${config.timeoutMs} ms`, {
          retryable: true,
          cause: error,
        });
      }
      // Anything else thrown by fetch is a network problem (DNS, connection reset...).
      throw new ImslpApiError(`Network error: ${error?.message ?? error}`, {
        retryable: true,
        cause: error,
      });
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new ImslpApiError('Unexpected response: body is not valid JSON', { cause: error });
    }
    return validateWorksResponse(body);
  }

  // Fetches one page of works: { works: [...raw records], metadata: {...} }.
  async function fetchWorksPage({ start, limit }) {
    const url = buildWorksUrl({ start, limit }, config.baseUrl);

    for (let attempt = 1; ; attempt++) {
      await waitForCrawlDelay();
      try {
        return await attemptRequest(url);
      } catch (error) {
        if (!error.retryable) throw error;
        if (attempt > config.retries) {
          throw new ImslpApiError(`${error.message} (gave up after ${attempt} attempts)`, {
            status: error.status,
            retryable: true,
            cause: error,
          });
        }
        const waitMs = backoffMs(attempt, error);
        log(`IMSLP retry ${attempt}/${config.retries} in ${waitMs} ms: ${error.message}`);
        await sleepFn(waitMs);
      }
    }
  }

  return { fetchWorksPage };
}

// Convenience: a shared client with default settings.
const defaultClient = createImslpClient();

export function fetchWorksPage({ start, limit }) {
  return defaultClient.fetchWorksPage({ start, limit });
}
