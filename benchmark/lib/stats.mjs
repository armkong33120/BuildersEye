// stats.mjs — Statistical helpers for the benchmark.
// All metrics are derived from ACTUAL observed values (arrays of numbers).
// No fabricated values: empty input yields null, never a made-up number.

/** Mean of a non-empty numeric array. */
export function mean(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Percentile (p in [0,1]) of a sorted or unsorted numeric array. */
export function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export function p50(arr) { return percentile(arr, 0.5); }
export function p95(arr) { return percentile(arr, 0.95); }

/** Sample standard deviation (n-1). */
export function stddev(arr) {
  if (!arr || arr.length < 2) return null;
  const m = mean(arr);
  const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

/** 95% confidence interval half-width (t-approx via 1.96) for a numeric array. */
export function confidenceInterval(arr) {
  if (!arr || arr.length < 2) return null;
  const s = stddev(arr);
  if (s == null) return null;
  return 1.96 * (s / Math.sqrt(arr.length));
}

/**
 * Aggregate a set of numeric samples into a summary object.
 * Returns { count, mean, median, p95, stddev, ci95, min, max }.
 */
export function summarize(arr) {
  if (!arr || arr.length === 0) return { count: 0, mean: null, median: null, p95: null, stddev: null, ci95: null, min: null, max: null };
  const sorted = [...arr].sort((a, b) => a - b);
  const ci = confidenceInterval(arr);
  return {
    count: arr.length,
    mean: round(mean(arr)),
    median: round(median(sorted)),
    p95: round(percentile(sorted, 0.95)),
    stddev: stddev(arr) == null ? null : round(stddev(arr)),
    ci95: ci == null ? null : round(ci),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
  };
}

export function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Round to a fixed number of decimals (default 1). */
export function round(v, d = 1) {
  if (v == null || Number.isNaN(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/** Percentage of truthy values in a boolean array (null when empty). */
export function rate(arr) {
  if (!arr || arr.length === 0) return null;
  const t = arr.filter(Boolean).length;
  return round((t / arr.length) * 100, 1);
}
