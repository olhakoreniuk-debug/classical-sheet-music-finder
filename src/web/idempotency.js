// Idempotency-Key handling for POST /works (openapi.yaml, createWork):
// - first request with a key: processed normally;
// - same key + identical body within 24 h: the original 201 is replayed;
// - same key + different body: 422 (idempotency_key_reused);
// - same key while the first request is still running: 409.
//
// Kept in memory: the API is a single local process (ADR-0003). Keys are lost
// when the server restarts, which only means a retry after a restart is
// processed as a new request (a duplicate page URL is still rejected).

import { createHash } from 'node:crypto';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 10_000;

/** Stable JSON (sorted keys) so that key order does not make two bodies "different". */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function fingerprint(body) {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

export function createIdempotencyStore({ now = () => Date.now(), ttlMs = IDEMPOTENCY_TTL_MS } = {}) {
  /** key -> { fingerprint, state: 'pending' | 'done', response, expiresAt } */
  const entries = new Map();

  function prune() {
    const time = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= time) entries.delete(key);
    }
    // Bounded memory: drop the oldest entries first (Map keeps insertion order).
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
  }

  return {
    /**
     * @returns {{ kind: 'new' } | { kind: 'replay', response: object } | { kind: 'mismatch' } | { kind: 'pending' }}
     *   'new' reserves the key until complete() or release()
     */
    begin(key, bodyFingerprint) {
      prune();
      const entry = entries.get(key);
      if (!entry) {
        entries.set(key, { fingerprint: bodyFingerprint, state: 'pending', response: null, expiresAt: now() + ttlMs });
        return { kind: 'new' };
      }
      if (entry.fingerprint !== bodyFingerprint) return { kind: 'mismatch' };
      if (entry.state === 'pending') return { kind: 'pending' };
      return { kind: 'replay', response: entry.response };
    },
    complete(key, response) {
      const entry = entries.get(key);
      if (entry) Object.assign(entry, { state: 'done', response });
    },
    /** The request failed: forget the key so that a corrected retry is processed. */
    release(key) {
      entries.delete(key);
    },
  };
}
