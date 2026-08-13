// score.js — Single source of truth for relevance/confidence score normalization.
//
// The pipeline has TWO different score scales:
//   - keyword search (server/searchIndex.js): 0..100 (already a percentage)
//   - vector search  (server/vectorStore.js):  0..1   (cosine similarity)
//
// Normalize ONCE to a 0..100 percentage and clamp to never exceed 100%.
//   normalizeScore(1)    → 100
//   normalizeScore(0.91) → 91
//   normalizeScore(100)  → 100
//   normalizeScore(137)  → 100  (never above 100%)
export function normalizeScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  // A value in (0, 1] is a fraction → scale to percent. Anything > 1 is
  // already a percentage. Clamp to [0, 100] so we never show >100%.
  const pct = n > 1 ? n : n * 100;
  return Math.max(0, Math.min(100, pct));
}

// Human-friendly integer percent label for display (e.g. "91%").
export function percentLabel(score) {
  return Math.round(normalizeScore(score)) + '%';
}
