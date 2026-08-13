// compare.mjs — Before/after benchmark comparison.
// Usage: node benchmark/compare.mjs [before-results.json] [after-results.json]
// Defaults: benchmark/output.before/results.json and benchmark/output.after/results.json
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function load(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function readArgs() {
  const a = process.argv.slice(2);
  if (a.length >= 2) return { before: a[0], after: a[1] };
  return {
    before: path.join(__dirname, 'output.before', 'results.json'),
    after: path.join(__dirname, 'output.after', 'results.json'),
  };
}

function delta(before, after) {
  if (before == null || after == null) return 'N/A';
  const d = after - before;
  return `${d > 0 ? '+' : ''}${d.toFixed(2)}`;
}

function row(name, b, a, fmt = (v) => (v == null ? 'N/A' : String(v))) {
  return `| ${name} | ${fmt(b)} | ${fmt(a)} | ${b != null && a != null ? delta(b, a) : 'N/A'} |`;
}

const pct = (v) => (v == null ? 'N/A' : `${v}%`);
const ms = (v) => (v == null ? 'N/A' : `${v}ms`);

const { before, after } = readArgs();
const B = load(before);
const A = load(after);

if (!B || !A) {
  console.error('Could not load both result files.');
  if (!B) console.error('  missing before:', before);
  if (!A) console.error('  missing after:', after);
  process.exit(1);
}

const bm = B.metrics || {};
const am = A.metrics || {};
const info = (o) => `mode=${o?.config?.mode ?? '?'} iter=${o?.config?.iterations ?? '?'} cases=${o?.config?.caseCount ?? '?'} (${o?.runAt ?? '?'})`;

console.log('# BuildersEye Benchmark — Before/After Comparison\n');
console.log(`- **Before**: ${info(B)}`);
console.log(`- **After**:  ${info(A)}\n`);

console.log('## Summary Metrics\n');
console.log('| Metric | Before | After | Δ |');
console.log('|--------|--------|-------|---|');
console.log(row('Total cases', bm.counts?.total, am.counts?.total));
console.log(row('OK cases', bm.counts?.ok, am.counts?.ok));
console.log(row('Errors', bm.counts?.errors, am.counts?.errors));
console.log(row('Skipped', bm.counts?.skipped, am.counts?.skipped));
console.log(row('Route accuracy', bm.routeAccuracy, am.routeAccuracy, pct));
console.log(row('Block accuracy', bm.blockAccuracy, am.blockAccuracy, pct));
console.log(row('Answer-type accuracy', bm.answerTypeAccuracy, am.answerTypeAccuracy, pct));
console.log(row('Leakage rate', bm.leakageRate, am.leakageRate, pct));
console.log(row('Fallback rate', bm.fallbackRate, am.fallbackRate, pct));
console.log(row('LLM-used rate', bm.llmUsedRate, am.llmUsedRate, pct));
console.log(row('Error rate', bm.errorRate, am.errorRate, pct));
console.log(row('Recall@10 (mean)', bm.recallAt10?.mean, am.recallAt10?.mean));
console.log(row('MRR (mean)', bm.mrr?.mean, am.mrr?.mean));
console.log(row('Latency mean', bm.latency?.mean, am.latency?.mean, ms));
console.log(row('Latency p50', bm.latency?.median, am.latency?.median, ms));
console.log(row('Latency p95', bm.latency?.p95, am.latency?.p95, ms));
console.log(row('Cache hits', bm.cacheHitCount, am.cacheHitCount));
console.log('');

function section(title, bObj, aObj) {
  console.log(`## ${title}\n`);
  console.log('| Key | Block acc (before → after) | Route acc (before → after) | Leakages (b → a) |');
  console.log('|-----|----------------------------|----------------------------|------------------|');
  const keys = new Set([...Object.keys(bObj || {}), ...Object.keys(aObj || {})]);
  for (const k of [...keys].sort()) {
    const b = bObj?.[k] || {};
    const a = aObj?.[k] || {};
    const bBlk = b.blockEval ? `${(b.blockOk / b.blockEval * 100).toFixed(1)}%` : 'N/A';
    const aBlk = a.blockEval ? `${(a.blockOk / a.blockEval * 100).toFixed(1)}%` : 'N/A';
    const bRte = b.routeEval ? `${(b.routeOk / b.routeEval * 100).toFixed(1)}%` : 'N/A';
    const aRte = a.routeEval ? `${(a.routeOk / a.routeEval * 100).toFixed(1)}%` : 'N/A';
    console.log(`| ${k} | ${bBlk} → ${aBlk} | ${bRte} → ${aRte} | ${b.leakage ?? 0} → ${a.leakage ?? 0} |`);
  }
  console.log('');
}

section('Per-Category', B.byCategory, A.byCategory);
section('Per-Role', B.byRole, A.byRole);
