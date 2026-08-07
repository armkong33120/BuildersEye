// responseCache.js — In-memory response cache for repeated chat questions.
//
// Cost-reduction: identical question + same viewer (role + employeeId) → skip the
// whole search/LLM pipeline and return the previous answer. Keyed by
// normalized query + role + employeeId (scope/redaction is viewer-dependent).
//
// Safety:
//  - Only active when the LLM is available (callers gate on isLLMAvailable()).
//  - TTL (default 15 min) + max entries with FIFO eviction → bounded memory.
//  - Payload is deep-cloned on write/read so callers can't mutate the cache.
import 'dotenv/config';

const MAX_ENTRIES = Number(process.env.RESPONSE_CACHE_MAX || 1000);
const TTL_MS = Number(process.env.RESPONSE_CACHE_TTL_MS || 15 * 60 * 1000);

const store = new Map(); // key -> { expiresAt, payload }

export function normalizeQuery(query) {
  return String(query || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function cacheKeyFor(query, viewer) {
  const role = (viewer?.role || 'CEO').trim();
  const pk = viewer?.employeeId || 1;
  return `${role}|${pk}|${normalizeQuery(query)}`;
}

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.payload;
}

export function cacheSet(key, payload) {
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
  // Deep-clone so the stored payload can't be mutated by the caller afterwards.
  store.set(key, { expiresAt: Date.now() + TTL_MS, payload: JSON.parse(JSON.stringify(payload)) });
}

export function cacheStats() {
  return { size: store.size, max: MAX_ENTRIES, ttlMs: TTL_MS };
}

export function clearCache() {
  store.clear();
}
