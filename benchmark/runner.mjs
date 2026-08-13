// runner.mjs — BuildersEye RAG Benchmark runner.
// Modes: DIRECT (default, imports chatHandler) or HTTP (--http).
// Features: N iterations, per-category/per-role aggregation, pronoun context
// seeding, cache cold/warm. Every metric comes from actual pipeline responses.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluateCase, aggregate } from './lib/metrics.mjs';
import { generateReport } from './report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load server/.env so DIRECT mode sees LLM keys.
try {
  const envPath = path.join(ROOT, 'server', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch {}

const args = process.argv.slice(2);
const USE_HTTP = args.includes('--http');
const PORT = parseInt(args.find((a) => a.startsWith('--port='))?.split('=')[1] || '5199', 10);
const ITER = parseInt(args.find((a) => a.startsWith('--iterations='))?.split('=')[1] || '', 10);
const FILTER = args.find((a) => a.startsWith('--filter='))?.split('=')[1]?.split(',').map((s) => s.trim()).filter(Boolean);
const CATEGORY = args.find((a) => a.startsWith('--category='))?.split('=')[1];

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const K_VALUES = CONFIG.kValues;
const N = Number.isInteger(ITER) && ITER > 0 ? ITER : CONFIG.iterations;
const OUT_DIR = path.join(__dirname, 'output');
const CASES_PATH = path.join(__dirname, 'dataset', 'cases.json');

function loadCases() {
  let cases = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'));
  if (FILTER) cases = cases.filter((c) => FILTER.includes(c.id));
  if (CATEGORY) cases = cases.filter((c) => c.category === CATEGORY);
  return cases;
}

function viewerFor(role) {
  return CONFIG.roleMapping[role] || { role: role || 'CEO', employeeId: 1 };
}

function isLLMAvailable() {
  const key = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  return process.env.LLM_SKIP !== 'true' && Boolean(key) && key !== 'your_api_key_here';
}

// ── Pipeline loading (DIRECT mode) ──────────────────────────────────────────
async function loadDirectPipeline() {
  const serverDir = path.join(ROOT, 'server');
  const { ingestAll } = await import(path.join(serverDir, 'ingestExcel.js'));
  let dataDir = process.env.HR_DATA_DIR;
  if (dataDir) { dataDir = path.resolve(dataDir); if (!fs.existsSync(dataDir)) dataDir = null; }
  if (!dataDir) dataDir = path.join(ROOT, 'src', 'data', 'hr_onedrive_demo');

  let loaded = null;
  try {
    const { buildRegistry, getActiveEmployees } = await import(path.join(serverDir, 'employeeRegistry.js'));
    const { getCacheDirSafe } = await import(path.join(serverDir, 'runRegistry.js'));
    const { registryToFlatIndex } = await import(path.join(serverDir, 'registryIngest.js'));
    buildRegistry(getCacheDirSafe());
    const emps = getActiveEmployees();
    if (emps.length > 0) {
      const r = registryToFlatIndex(emps);
      loaded = { flatIndex: r.flatIndex, searchIndex: r.searchIndex, source: 'registry', count: emps.length };
    }
  } catch (e) { console.warn('[runner] registry load failed, using file ingest:', e.message); }

  if (!loaded) {
    const r = ingestAll(dataDir);
    loaded = { flatIndex: r.flatIndex, searchIndex: r.searchIndex, source: 'files', count: r.totalFiles };
  }

  let identityGraph = { identities: [] };
  const graphPath = path.join(ROOT, 'src', 'data', 'identity-graph.json');
  try { identityGraph = fs.existsSync(graphPath) ? JSON.parse(fs.readFileSync(graphPath, 'utf-8')) : identityGraph; } catch {}

  try {
    const { initDatabase } = await import(path.join(serverDir, 'sqlEngine.js'));
    initDatabase(loaded.flatIndex);
  } catch (e) { console.warn('[runner] SQL init failed:', e.message); }

  const chatMod = await import(path.join(serverDir, 'chatController.js'));
  return { flatIndex: loaded.flatIndex, searchIndex: loaded.searchIndex, identityGraph, chatHandlerFn: chatMod.chatHandler };
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
let httpToken = null;
async function httpPost(base, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (httpToken) headers.Authorization = 'Bearer ' + httpToken;
  const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: null }; }
}
async function ensureHttpAuth(base) {
  const u = process.env.TEST_USERNAME, p = process.env.TEST_PASSWORD;
  if (!u || !p) return;
  const r = await httpPost(`${base}/api/auth/login`, { username: u, password: p });
  if (r.status === 200 && r.data?.accessToken) httpToken = r.data.accessToken;
}

// ── Main orchestration ──────────────────────────────────────────────────────
async function main() {
  const cases = loadCases();
  console.log('══════════════════════════════════════════');
  console.log('  BuildersEye RAG Benchmark');
  console.log('══════════════════════════════════════════');
  console.log(`Cases: ${cases.length} | Mode: ${USE_HTTP ? 'HTTP' : 'DIRECT'} | Iterations: ${N}`);
  console.log(`LLM available: ${isLLMAvailable()}`);
  console.log('');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let deps = null;
  let base = null;
  if (USE_HTTP) {
    base = `http://localhost:${PORT}`;
    await ensureHttpAuth(base);
  } else {
    deps = await loadDirectPipeline();
  }

  const t0 = Date.now();
  const perCase = new Map();
  const runCase = async (c, iteration) => {
    const viewer = viewerFor(c.role);
    const convId = `bench-${iteration}-${c.id}`;
    let data;
    try {
      if (USE_HTTP) {
        const post = (query) => httpPost(`${base}/api/chat`, { query, conversationId: convId, viewer });
        if (c.context) await post(c.context);
        if (c.repeat) {
          await post(c.query);
          data = (await post(c.query)).data || {};
        } else {
          data = (await post(c.query)).data || {};
        }
      } else {
        if (c.context) await deps.chatHandlerFn(c.context, viewer, deps, convId);
        if (c.repeat) {
          await deps.chatHandlerFn(c.query, viewer, deps, convId);
          data = await deps.chatHandlerFn(c.query, viewer, deps, convId);
        } else {
          data = await deps.chatHandlerFn(c.query, viewer, deps, convId);
        }
      }
      return evaluateCase(c, data, K_VALUES);
    } catch (e) {
      return { id: c.id, query: c.query, category: c.category, role: c.role, status: 'ERROR', error: e.message };
    }
  };

  for (let it = 1; it <= N; it++) {
    for (const c of cases) {
      const ev = await runCase(c, it);
      if (!perCase.has(c.id)) perCase.set(c.id, { case: c, evaluations: [] });
      perCase.get(c.id).evaluations.push(ev);
      process.stdout.write(`\r[${it}/${N}] ${perCase.size}/${cases.length} ${c.id} (${c.category})   `);
    }
  }
  console.log('');

  const results = [];
  for (const [, { case: c, evaluations }] of perCase) {
    const okEvals = evaluations.filter((e) => e.status === 'OK');
    if (okEvals.length === 0) { results.push(evaluations[0]); continue; }
    const base = { ...okEvals[0] };
    const recall = {}; const precision = {};
    for (const k of K_VALUES) {
      recall[`r@${k}`] = avg(okEvals.map((e) => e.recall?.[`r@${k}`]));
      precision[`p@${k}`] = avg(okEvals.map((e) => e.precision?.[`p@${k}`]));
    }
    results.push({
      ...base,
      recall, precision,
      mrr: avg(okEvals.map((e) => e.mrr)),
      factContainment: avg(okEvals.map((e) => e.factContainment)),
      departmentAccuracy: avg(okEvals.map((e) => e.departmentAccuracy)),
      latencyMs: Math.round(avg(okEvals.map((e) => e.latencyMs)) || 0),
      cached: okEvals.some((e) => e.cached),
      routeMatch: okEvals.every((e) => e.routeMatch),
      blockedMatch: okEvals.every((e) => e.blockedMatch),
      leakage: okEvals.some((e) => e.leakage),
      iterations: okEvals.length,
    });
  }

  const agg = aggregate(results);
  const totalTimeMs = Date.now() - t0;

  const out = {
    runAt: new Date().toISOString(),
    config: {
      mode: USE_HTTP ? 'http' : 'direct',
      iterations: N,
      llmAvailable: isLLMAvailable(),
      caseCount: cases.length,
      kValues: K_VALUES,
    },
    metrics: agg.metrics,
    byCategory: agg.byCategory,
    byRole: agg.byRole,
    failures: agg.failures.map((r) => ({ id: r.id, query: r.query, category: r.category, role: r.role, actualRoute: r.actualRoute, expectedRoute: r.expectedRoute })),
    leakages: agg.leakages.map((r) => ({ id: r.id, query: r.query, role: r.role, note: r.leakageNote })),
    errors: agg.errors.map((r) => ({ id: r.id, error: r.error })),
    totalTimeMs,
    results: CONFIG.report.includeRawResults ? results : undefined,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), generateReport(out));
  console.log(`[JSON] ${path.join(OUT_DIR, 'results.json')}`);
  console.log(`[MD]   ${path.join(OUT_DIR, 'report.md')}`);
  console.log(`Total time: ${(totalTimeMs / 1000).toFixed(1)}s`);
  printSummary(agg.metrics);
}

function avg(arr) {
  const a = arr.filter((v) => v != null && !Number.isNaN(v));
  if (a.length === 0) return null;
  return Math.round(a.reduce((x, y) => x + y, 0) / a.length * 1000) / 1000;
}

function fmt(v) { return v == null ? 'N/A' : String(v); }

function printSummary(m) {
  console.log('\n─── Benchmark Summary ───');
  console.log(`  Cases: ${m.counts.total} (OK ${m.counts.ok}, errors ${m.counts.errors}, skipped ${m.counts.skipped})`);
  console.log(`  Route accuracy:    ${fmt(m.routeAccuracy)}%`);
  console.log(`  Block accuracy:    ${fmt(m.blockAccuracy)}%`);
  console.log(`  Answer-type acc:   ${fmt(m.answerTypeAccuracy)}%`);
  console.log(`  Recall@10 (mean):  ${fmt(m.recallAt10?.mean)}`);
  console.log(`  MRR (mean):        ${fmt(m.mrr?.mean)}`);
  console.log(`  Leakage rate:      ${fmt(m.leakageRate)}% (${m.leakageCount} cases)`);
  console.log(`  Fallback rate:     ${fmt(m.fallbackRate)}%`);
  console.log(`  Error rate:        ${fmt(m.errorRate)}%`);
  console.log(`  Avg latency:       ${fmt(m.latency?.mean)}ms (p95 ${fmt(m.latency?.p95)}ms)`);
  console.log(`  Cache hits:        ${m.cacheHitCount}`);
  console.log('');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });

