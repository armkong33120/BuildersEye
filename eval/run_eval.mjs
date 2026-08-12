#!/usr/bin/env node
// run_eval.mjs — RAG Evaluation Framework for BuildersEye
// Two modes: HTTP (--http) or DIRECT (default, imports chatHandler)
// Usage:  node eval/run_eval.mjs [--http] [--port=5199] [--filter=q001,q026]
// Output: eval/output/results.json  +  eval/output/report.md

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load .env from server/ directory (where the actual .env lives)
try {
  const envPath = path.join(ROOT, 'server', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch (e) { /* .env load failed; env vars must be set externally */ }

const args = process.argv.slice(2);
const USE_HTTP = args.includes('--http');
const PORT = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '5199', 10);
const FILTER_IDS = args.find(a => a.startsWith('--filter='))?.split('=')[1]?.split(',').map(s => s.trim());

const OUT_DIR = path.join(__dirname, 'output');
const RESULTS_PATH = path.join(OUT_DIR, 'results.json');
const REPORT_PATH = path.join(OUT_DIR, 'report.md');

const GOLDEN_PATH = path.join(__dirname, 'golden_questions.json');
let goldenQuestions;
try { goldenQuestions = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf-8')); }
catch (e) { console.error('Failed to load golden questions:', e.message); process.exit(1); }

let questions = goldenQuestions;
if (FILTER_IDS) {
  questions = goldenQuestions.filter(q => FILTER_IDS.includes(q.id));
  console.log(`Filtered to ${questions.length} question(s): ${FILTER_IDS.join(', ')}`);
}

const ROLES = {
  CEO:      { role: 'CEO',      employeeId: 1 },
  HR:       { role: 'HR',       employeeId: 2 },
  Manager:  { role: 'Manager',  employeeId: 10 },
  Employee: { role: 'Employee', employeeId: 42 },
};

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function checkLLMAvailable() {
  const apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  const skip = process.env.LLM_SKIP === 'true';
  return !skip && Boolean(apiKey) && apiKey !== 'your_api_key_here';
}

// ── Route classification helpers ──
function classifyRoute(data) {
  if (!data) return 'error';
  if (data.policy?.status === 'Blocked') return 'blocked';
  if (data.sqlUsed) return 'sql';
  if (data.matchersUsed?.includes('vector-search')) return 'vector';
  if (data.matchersUsed?.length > 0) return 'keyword';
  if (data.answerSource === 'clarification') return 'clarification';
  return 'keyword';
}
function isBlocked(data) { return data?.policy?.status === 'Blocked'; }
function countResults(data) {
  if (!data) return 0;
  if (data.matchedEmployeePks) return data.matchedEmployeePks.length;
  if (data.results) return data.results.length;
  return 0;
}
function sanitizeAnswer(a) { return a ? String(a).slice(0, 500) : ''; }

function isLLMDependent(q) {
  return ['sql_analytics','vector_retrieval','pronoun_followup','cache_hit'].includes(q.category);
}

// ── Route matching ──
function checkRouteMatch(q, actualRoute, data) {
  // If query is expected to be blocked and it IS blocked → match regardless of route
  if (q.expectedBlocked && isBlocked(data)) return true;
  if (q.expectedNotRoute && actualRoute === q.expectedNotRoute) return false;
  if (q.expectedRoute === 'blocked') return actualRoute === 'blocked';
  if (q.category === 'sql_analytics' && actualRoute === 'sql') return true;
  if (q.category === 'vector_retrieval' && actualRoute === 'vector') return true;
  if (actualRoute === q.expectedRoute) return true;
  if (['keyword','vector'].includes(actualRoute) && ['keyword','vector'].includes(q.expectedRoute)) return true;
  if (q.category === 'factual_lookup' && actualRoute === 'keyword') return true;
  if (q.category === 'ambiguous') return true;
  return false;
}

// ── RBAC leakage check ──
function checkRBACLeakage(q, data) {
  if (!data || data.policy?.status === 'Blocked') return { leak: false, note: '' };
  if (q.rbacRole === 'CEO' || q.rbacRole === 'HR') return { leak: false, note: '' };
  const answer = (data.answer || '').toLowerCase();
  if (q.rbacRole === 'Employee') {
    if (/base_salary|bonus_months|compensation|เงินเดือน|โบนัส|ค่าจ้าง/i.test(answer)) {
      const selfPk = ROLES[q.rbacRole]?.employeeId;
      if (data.matchedEmployeePks && data.matchedEmployeePks.length === 1 &&
          data.matchedEmployeePks[0] === selfPk) return { leak: false, note: 'self-lookup OK' };
      return { leak: true, note: 'Employee saw salary/compensation data of others' };
    }
  }
  return { leak: false, note: '' };
}

// ── Build result from question + chatHandler response ──
function buildResult(q, data, latencyMs, llmAvailable) {
  const actualRoute = classifyRoute(data);
  const actualBlocked = isBlocked(data);
  const rbac = checkRBACLeakage(q, data);
  const routeMatch = checkRouteMatch(q, actualRoute, data);

  // Special: q026 regression
  let routeDetails = '';
  if (q.id === 'q026') {
    routeDetails = `REGRESSION: sqlUsed=${data?.sqlUsed||false}, route=${actualRoute}`;
    if (data?.sqlUsed || actualRoute === 'sql')
      routeDetails += ' — FAIL: incorrect SQL routing';
  }

  return {
    id: q.id, query: q.query, category: q.category, rbacRole: q.rbacRole,
    status: 'OK', latencyMs,
    actualRoute, expectedRoute: q.expectedRoute, routeMatch, routeDetails,
    expectedBlocked: q.expectedBlocked, actualBlocked,
    blockedMatch: actualBlocked === q.expectedBlocked,
    resultCount: countResults(data), expectedMinResults: q.expectedMinResults,
    resultCountOk: actualBlocked ? true : countResults(data) >= q.expectedMinResults,
    answer: sanitizeAnswer(data?.answer || ''),
    answerSource: data?.answerSource || 'unknown',
    llmUsed: data?.llmUsed || false, sqlUsed: data?.sqlUsed || false,
    matchersUsed: data?.matchersUsed || [],
    rbacLeakageDetected: rbac.leak, rbacNotes: rbac.note,
    trace: data?.trace || [],
    llmSkipped: !llmAvailable && isLLMDependent(q),
    skippedReason: !llmAvailable && isLLMDependent(q) ? 'LLM key unavailable' : '',
    cached: data?.cached || false,
    policyStatus: data?.policy?.status || 'N/A',
  };
}

// ── HTTP mode: talk to running backend ──
async function evalViaHTTP() {
  const BASE = `http://localhost:${PORT}`;
  try {
    const h = await fetch(`${BASE}/api/health`);
    if (!h.ok) throw new Error(`Health ${h.status}`);
    console.log(`[http] Backend healthy at ${BASE}`);
  } catch (e) {
    console.error(`[http] Cannot reach ${BASE}. Start: cd server && node index.js`);
    process.exit(1);
  }
  const results = []; const t0 = Date.now();
  const llmOk = checkLLMAvailable();
  for (const q of questions) {
    const viewer = ROLES[q.rbacRole] || ROLES.CEO;
    const ts = Date.now();
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q.query, viewer, conversationId: `eval-${q.id}` }),
      });
      const data = await res.json();
      results.push(buildResult(q, data, Date.now() - ts, llmOk));
    } catch (e) {
      results.push({ id: q.id, query: q.query, category: q.category, rbacRole: q.rbacRole,
        status: 'ERROR', error: e.message, latencyMs: Date.now() - ts });
    }
  }
  return { results, totalTimeMs: Date.now() - t0, llmAvailable: llmOk };
}

// ── DIRECT mode: import chatHandler and data modules ──
async function evalDirect() {
  console.log('[direct] Loading data modules...');
  const serverDir = path.join(ROOT, 'server');
  let flatIndex, searchIndex, identityGraph, chatHandlerFn;

  try {
    const { ingestAll } = await import(path.join(serverDir, 'ingestExcel.js'));
    let dataDir = process.env.HR_DATA_DIR;
    if (dataDir) { dataDir = path.resolve(dataDir); if (!fs.existsSync(dataDir)) dataDir = null; }
    if (!dataDir) {
      const od = path.join(process.env.HOME || '/Users/arm',
        'Library/CloudStorage/OneDrive-UbonRatchathaniUniversity/BuildersEye HR Demo Dataset/Employees');
      dataDir = fs.existsSync(od) ? od : path.join(ROOT, 'src', 'data', 'hr_onedrive_demo');
    }
    console.log(`[direct] Data dir: ${dataDir}`);

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
    } catch (e) { console.warn('[direct] Registry load failed:', e.message); }

    if (!loaded) {
      console.log('[direct] Falling back to file ingest...');
      const r = ingestAll(dataDir);
      loaded = { flatIndex: r.flatIndex, searchIndex: r.searchIndex, source: 'files', count: r.totalFiles };
    }

    flatIndex = loaded.flatIndex;
    searchIndex = loaded.searchIndex;
    console.log(`[direct] Loaded ${loaded.count} records from ${loaded.source}`);

    try {
      const graphPath = path.join(ROOT, 'src', 'data', 'identity-graph.json');
      if (fs.existsSync(graphPath)) {
        identityGraph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
        console.log('[direct] Identity graph loaded');
      }
    } catch (e) { console.warn('[direct] Identity graph failed:', e.message); identityGraph = { identities: [] }; }

    try {
      const { initDatabase } = await import(path.join(serverDir, 'sqlEngine.js'));
      initDatabase(flatIndex);
      console.log('[direct] SQL engine initialized');
    } catch (e) { console.warn('[direct] SQL init failed:', e.message); }

    const chatMod = await import(path.join(serverDir, 'chatController.js'));
    chatHandlerFn = chatMod.chatHandler;
  } catch (e) {
    console.error('[direct] Module load failed:', e.message);
    console.error('[direct] Try HTTP mode: node eval/run_eval.mjs --http');
    process.exit(1);
  }

  const llmOk = checkLLMAvailable();
  if (!llmOk) console.log('[direct] LLM key unavailable — LLM-dependent checks SKIPPED');
  else console.log('[direct] LLM key found — full evaluation enabled');

  const results = []; const t0 = Date.now();
  for (const q of questions) {
    const viewer = ROLES[q.rbacRole] || ROLES.CEO;
    const ts = Date.now();
    try {
      const data = await chatHandlerFn(q.query, viewer,
        { flatIndex, searchIndex, identityGraph }, `eval-${q.id}`);
      results.push(buildResult(q, data, Date.now() - ts, llmOk));
    } catch (e) {
      results.push({ id: q.id, query: q.query, category: q.category, rbacRole: q.rbacRole,
        status: 'ERROR', error: e.message, latencyMs: Date.now() - ts });
    }
  }
  return { results, totalTimeMs: Date.now() - t0, llmAvailable: llmOk };
}

// ── Compute evaluation metrics ──
function computeMetrics(results, config) {
  const total = results.length;
  const ok = results.filter(r => r.status === 'OK');
  const errors = results.filter(r => r.status === 'ERROR');
  const blocked = results.filter(r => r.actualBlocked);
  const skipped = results.filter(r => r.llmSkipped);
  const active = results.filter(r => !r.llmSkipped && r.status === 'OK');

  const routeEval = active.filter(r => !r.actualBlocked);
  const routeCorrect = routeEval.filter(r => r.routeMatch);
  const routeAccuracy = routeEval.length ? (routeCorrect.length / routeEval.length * 100).toFixed(1) : 'N/A';

  const blockEval = active.filter(r => r.expectedBlocked !== undefined);
  const blockCorrect = blockEval.filter(r => r.blockedMatch);
  const blockAccuracy = blockEval.length ? (blockCorrect.length / blockEval.length * 100).toFixed(1) : 'N/A';

  const resultEval = active.filter(r => !r.actualBlocked);
  const resultOk = resultEval.filter(r => r.resultCountOk);
  const resultRate = resultEval.length ? (resultOk.length / resultEval.length * 100).toFixed(1) : 'N/A';

  const lats = results.map(r => r.latencyMs).filter(ms => ms > 0).sort((a,b)=>a-b);
  const avgLat = lats.length ? (lats.reduce((a,b)=>a+b,0)/lats.length).toFixed(0) : 'N/A';
  const p50 = lats.length ? lats[Math.floor(lats.length*0.5)] : 'N/A';
  const p95 = lats.length ? lats[Math.floor(lats.length*0.95)] : 'N/A';

  const sqlMis = results.filter(r => r.category === 'sql_misclassification');
  const sqlMisPass = sqlMis.filter(r => r.routeMatch);
  const sqlMisState = sqlMis.length ? (sqlMisPass.length === sqlMis.length ? 'PASS' : 'FAIL') : 'N/A';

  const leakage = results.filter(r => r.rbacLeakageDetected);
  const leakageRate = total ? (leakage.length/total*100).toFixed(1) : 'N/A';

  const fallbacks = active.filter(r => r.answerSource === 'template' && !r.actualBlocked);
  const fallbackRate = active.length ? (fallbacks.length/active.length*100).toFixed(1) : 'N/A';

  const byCat = {};
  for (const r of results) {
    const c = r.category;
    if (!byCat[c]) byCat[c] = { total:0, routeOk:0, blockOk:0, resultOk:0, errors:0, skipped:0 };
    byCat[c].total++;
    if (r.status === 'ERROR') byCat[c].errors++;
    if (r.llmSkipped) byCat[c].skipped++;
    if (r.routeMatch) byCat[c].routeOk++;
    if (r.blockedMatch) byCat[c].blockOk++;
    if (r.resultCountOk) byCat[c].resultOk++;
  }

  const byRole = {};
  for (const r of results) {
    const ro = r.rbacRole;
    if (!byRole[ro]) byRole[ro] = { total:0, routeOk:0, blockOk:0, leakage:0 };
    byRole[ro].total++;
    if (r.routeMatch) byRole[ro].routeOk++;
    if (r.blockedMatch) byRole[ro].blockOk++;
    if (r.rbacLeakageDetected) byRole[ro].leakage++;
  }

  return {
    summary: { total, ok: ok.length, errors: errors.length, blocked: blocked.length, skipped: skipped.length,
      llmAvailable: config.llmAvailable, mode: config.mode, totalTimeMs: config.totalTimeMs },
    scores: { routeAccuracy, blockAccuracy, resultRate, sqlMisclassification: sqlMisState,
      rbacLeakageRate: leakageRate, fallbackRate, unsupportedCount: 0,
      avgLatencyMs: avgLat, p50LatencyMs: p50, p95LatencyMs: p95 },
    byCategory: byCat, byRole,
    sqlMisclassification: sqlMis.map(r => ({ id: r.id, query: r.query, sqlUsed: r.sqlUsed, actualRoute: r.actualRoute, routeMatch: r.routeMatch, details: r.routeDetails })),
    rbacLeakages: leakage.map(r => ({ id: r.id, query: r.query, role: r.rbacRole, answer: r.answer?.slice(0, 200) })),
    errors: errors.map(r => ({ id: r.id, error: r.error })),
    skipped: skipped.map(r => ({ id: r.id, reason: r.skippedReason })),
  };
}

// ── Generate Markdown report ──
function generateMarkdown(metrics) {
  const { summary, scores, byCategory: byCat, byRole, sqlMisclassification, rbacLeakages, errors, skipped } = metrics;
  let md = `# BuildersEye RAG Evaluation Report

**Generated:** ${new Date().toISOString()}
**Mode:** ${summary.mode}
**LLM Available:** ${summary.llmAvailable ? 'Yes' : 'No (LLM-dependent tests SKIPPED)'}
**Total Time:** ${summary.totalTimeMs}ms

## 1. Summary
| Metric | Value |
|--------|-------|
| Total Questions | ${summary.total} |
| OK | ${summary.ok} |
| Errors | ${summary.errors} |
| Blocked (by policy) | ${summary.blocked} |
| Skipped (LLM unavailable) | ${summary.skipped} |

## 2. Core Scores
| Metric | Score |
|--------|-------|
| Route Classification Accuracy | ${scores.routeAccuracy}${scores.routeAccuracy!=='N/A'?'%':''} |
| Policy Block Accuracy | ${scores.blockAccuracy}${scores.blockAccuracy!=='N/A'?'%':''} |
| Result Completeness Rate | ${scores.resultRate}${scores.resultRate!=='N/A'?'%':''} |
| SQL Misclassification (q026) | **${scores.sqlMisclassification}** |
| RBAC Leakage Rate | ${scores.rbacLeakageRate}${scores.rbacLeakageRate!=='N/A'?'%':''} |
| Template Fallback Rate | ${scores.fallbackRate}${scores.fallbackRate!=='N/A'?'%':''} |
| Avg Latency | ${scores.avgLatencyMs}${scores.avgLatencyMs!=='N/A'?'ms':''} |
| P50 Latency | ${scores.p50LatencyMs}${scores.p50LatencyMs!=='N/A'?'ms':''} |
| P95 Latency | ${scores.p95LatencyMs}${scores.p95LatencyMs!=='N/A'?'ms':''} |

## 3. By Category
| Category | Total | Route OK | Block OK | Result OK | Errors | Skipped |
|----------|-------|----------|----------|-----------|--------|--------|
`;
  for (const [cat, s] of Object.entries(byCat))
    md += `| ${cat} | ${s.total} | ${s.routeOk} | ${s.blockOk} | ${s.resultOk} | ${s.errors} | ${s.skipped} |\n`;

  md += `\n## 4. By Role
| Role | Total | Route OK | Block OK | RBAC Leakages |
|------|-------|----------|----------|---------------|
`;
  for (const [role, s] of Object.entries(byRole))
    md += `| ${role} | ${s.total} | ${s.routeOk} | ${s.blockOk} | ${s.leakage} |\n`;

  if (sqlMisclassification.length > 0) {
    md += `\n## 5. SQL Misclassification Regression (q026)\n`;
    md += `> Query "วิศวกรคนไหนทำ OT เทปูนข้ามคืน" contains "ปัญหา" triggering SQL regex.\n`;
    md += `> Expected: NOT routed to SQL. This is a FALSE POSITIVE for OT/construction queries.\n\n`;
    for (const r of sqlMisclassification)
      md += `| ${r.id} | sqlUsed=${r.sqlUsed} | route=${r.actualRoute} | ${r.routeMatch?'PASS ✅':'FAIL ❌'} | ${r.details} |\n`;
  }

  if (rbacLeakages.length > 0) {
    md += `\n## 6. RBAC Leakages\n| ID | Query | Role | Answer Snippet |\n|----|-------|------|---------------|\n`;
    for (const l of rbacLeakages)
      md += `| ${l.id} | ${l.query.slice(0,40)} | ${l.role} | ${(l.answer||'').slice(0,80)} |\n`;
  }

  if (errors.length > 0) {
    md += `\n## 7. Errors\n| ID | Error |\n|----|-------|\n`;
    for (const e of errors) md += `| ${e.id} | ${e.error} |\n`;
  }

  if (skipped.length > 0) {
    md += `\n## 8. Skipped (LLM Unavailable)\n`;
    for (const s of skipped) md += `- ${s.id}: ${s.reason}\n`;
  }

  md += `\n## 9. Methodology
- **Route classification**: determined from matchersUsed, sqlUsed, answerSource in response.
- **RBAC leakage**: keyword scans of answer for salary/compensation terms when viewer lacks permission.
- **Latency**: end-to-end from query to response.
- **SQL misclassification regression (q026)**: tests false-positive trigger of "ปัญหา" in SQL regex.
- **LLM-dependent tests**: sql_analytics, vector_retrieval queries SKIPPED when LLM_API_KEY unavailable.
`;
  return md;
}

// ── Main ──
async function main() {
  console.log('══════════════════════════════════════════');
  console.log('  BuildersEye RAG Evaluation Framework');
  console.log('══════════════════════════════════════════');
  console.log(`Questions: ${questions.length}`);
  console.log(`Mode: ${USE_HTTP ? 'HTTP (backend required)' : 'DIRECT (import modules)'}`);
  console.log('');

  ensureDir(OUT_DIR);

  const evalResult = USE_HTTP ? await evalViaHTTP() : await evalDirect();
  const { results, totalTimeMs, llmAvailable } = evalResult;

  const metrics = computeMetrics(results, { llmAvailable, mode: USE_HTTP ? 'http' : 'direct', totalTimeMs });

  // Write JSON
  const jsonOut = { runAt: new Date().toISOString(),
    config: { mode: USE_HTTP ? 'http' : 'direct', llmAvailable, questionCount: questions.length },
    metrics, results };
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(jsonOut, null, 2));
  console.log(`[JSON] Results → ${RESULTS_PATH}`);

  // Write Markdown
  const md = generateMarkdown(metrics);
  fs.writeFileSync(REPORT_PATH, md);
  console.log(`[MD]  Report  → ${REPORT_PATH}`);

  // Console summary
  console.log('\n─── Evaluation Summary ───');
  const sc = metrics.scores;
  console.log(`  Route Accuracy:        ${sc.routeAccuracy}${sc.routeAccuracy!=='N/A'?'%':''}`);
  console.log(`  Block Accuracy:        ${sc.blockAccuracy}${sc.blockAccuracy!=='N/A'?'%':''}`);
  console.log(`  SQL Misclassification: ${sc.sqlMisclassification}`);
  console.log(`  RBAC Leakage Rate:     ${sc.rbacLeakageRate}${sc.rbacLeakageRate!=='N/A'?'%':''}`);
  console.log(`  Avg Latency:           ${sc.avgLatencyMs}${sc.avgLatencyMs!=='N/A'?'ms':''}`);
  console.log(`  Fallback Rate:         ${sc.fallbackRate}${sc.fallbackRate!=='N/A'?'%':''}`);
  const sm = metrics.summary;
  console.log(`  Total: ${sm.total} | OK: ${sm.ok} | Errors: ${sm.errors} | Skipped: ${sm.skipped}`);
  console.log('');

  if (sc.sqlMisclassification === 'FAIL') {
    console.log('⚠️  SQL MISCLASSIFICATION REGRESSION FAILED!');
    console.log('   q026 "วิศวกรคนไหนทำ OT เทปูนข้ามคืน" incorrectly routed to SQL.');
    console.log('   The regex matches "ปัญหา" in the query. Fix: narrow the regex or add exclusion.');
    console.log('');
  }
  if (metrics.rbacLeakages.length > 0) {
    console.log(`⚠️  ${metrics.rbacLeakages.length} RBAC LEAKAGE(S) detected!`);
    console.log('');
  }
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
