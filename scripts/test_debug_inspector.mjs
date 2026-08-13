// test_debug_inspector.mjs — Focused tests for the Debug RAG Inspector fixes.
//
// Covers:
//   1. route/trace consistency       2. score normalization
//   3. history deduplication         4. JWT viewer identity
//   5. executed node count           6. provider/model metadata
//   7. no frontend secrets           8. unauth debug APIs -> 401
//   9. auth debug APIs -> safe JSON  10. identity answer relevance
//
// Unit sections run with no backend. API sections run against BACKEND_URL and
// are skipped gracefully when TEST_USERNAME/TEST_PASSWORD are not set.
//
// Usage: node scripts/test_debug_inspector.mjs
// Env:   BACKEND_URL TEST_USERNAME TEST_PASSWORD

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKEND = process.env.BACKEND_URL || 'http://localhost:5199';

let passed = 0, failed = 0, skipped = 0;
const assert = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
};
const sk = (name, reason) => { skipped++; console.log(`  ⏭️  ${name} — ${reason}`); };
const read = (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } };

async function fj(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = null; }
  return { s: r.status, d, t };
}

async function login(username, password) {
  return fj(`${BACKEND}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username, password }) });
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — Score normalization (unit, no backend)
// ═══════════════════════════════════════════════════════════════════════════
async function sectionScore() {
  console.log('\n── 1. Score normalization ──');
  let norm = null, lbl = null;
  try {
    ({ normalizeScore: norm, percentLabel: lbl } = await import('../server/score.js'));
  } catch (e) { sk('score normalization (import)', e.message); return; }
  assert('1 -> 100', norm(1) === 100, `got ${norm(1)}`);
  assert('0.91 -> 91', norm(0.91) === 91, `got ${norm(0.91)}`);
  assert('100 -> 100', norm(100) === 100, `got ${norm(100)}`);
  assert('137 -> clamped to 100 (never above 100%)', norm(137) === 100, `got ${norm(137)}`);
  assert('0 -> 0', norm(0) === 0, `got ${norm(0)}`);
  assert('0.5 -> 50', norm(0.5) === 50, `got ${norm(0.5)}`);
  assert('percentLabel(0.91) === "91%"', lbl(0.91) === '91%', `got ${lbl(0.91)}`);
  assert('percentLabel(100) === "100%"', lbl(100) === '100%', `got ${lbl(100)}`);
  assert('percentLabel(137) === "100%"', lbl(137) === '100%', `got ${lbl(137)}`);
  assert('normalize is idempotent (normalized exactly once)', norm(norm(0.91)) === norm(0.91), `double-apply changed value`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — Policy / blocked route stops at policy (unit)
// ═══════════════════════════════════════════════════════════════════════════
async function sectionPolicy() {
  console.log('\n── 2. Blocked query stops at policy ──');
  let policy = null;
  try { policy = await import('../server/policy.js'); } catch (e) { sk('policy (import)', e.message); return; }
  const blocked = policy.checkQueryPolicy('เงินเดือนของ EMP001 คือเท่าไหร่', 'Employee');
  assert('Employee + compensation -> Blocked', blocked.status === 'Blocked', JSON.stringify(blocked));
  const allowed = policy.checkQueryPolicy('EMP002 คือใคร', 'Employee');
  assert('Employee + identity -> Allowed', allowed.status === 'Allowed', JSON.stringify(allowed));
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — Provider/model metadata (unit)
// ═══════════════════════════════════════════════════════════════════════════
async function sectionProvider() {
  console.log('\n── 3. Provider/model metadata ──');
  let info = null;
  try {
    const mod = await import('../server/llmClient.js');
    info = mod.getProviderInfo();
  } catch (e) { sk('provider/model (import llmClient)', e.message); return; }
  assert('returns provider string', typeof info.provider === 'string' && info.provider.length > 0, JSON.stringify(info));
  assert('returns model string', typeof info.model === 'string' && info.model.length > 0, JSON.stringify(info));
  assert('does NOT leak API key', !/sk-|api[_-]?key|secret/i.test(JSON.stringify(info)), JSON.stringify(info));
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — Answer relevance (static: prompt rule present)
// ═══════════════════════════════════════════════════════════════════════════
function sectionRelevance() {
  console.log('\n── 4. Identity answer relevance ──');
  const llm = read(path.join(ROOT, 'server', 'llmClient.js'));
  assert('prompt contains "Answer ONLY what was asked"', llm.includes('Answer ONLY what was asked'), 'missing rule');
  assert('prompt constrains KPI on identity questions', llm.includes('Do NOT add KPI scores'), 'missing KPI constraint');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — Frontend: no secrets, no hardcoded provider, dedup, auth
// ═══════════════════════════════════════════════════════════════════════════
function sectionFrontendStatic() {
  console.log('\n── 5. Frontend static (debug page) ──');
  const h = read(path.join(ROOT, 'debug_neural_network_diagram.html'));

  // no hardcoded provider
  assert('no "gemini" hardcoded', !/gemini/i.test(h), 'found gemini');
  assert('no "DeepSeek" hardcoded', !/deepseek/i.test(h), 'found deepseek');

  // no secrets
  assert('no "root/1234" gate', !(h.includes('root') && h.includes('1234')), 'found root/1234');
  assert('no sessionStorage auth', !h.includes("sessionStorage.setItem('auth"), 'found sessionStorage auth');
  assert('no hardcoded sk- key', !/sk-[a-zA-Z0-9]{20,}/.test(h), 'found sk- key');

  // score normalization present (single function, not blanket *100)
  assert('has normalizeScore()', h.includes('function normalizeScore'), 'missing');
  assert('score display uses normalizeScore', h.includes('Math.round(normalizeScore(score))'), 'missing');
  assert('no bare score*100 on chunks', !h.includes('Math.round(score*100)'), 'found score*100');

  // history dedup
  assert('history dedup by id', h.includes('h.some(e=>e.id===id)'), 'missing dedup check');
  assert('poll dedup by id', h.includes('d.id!==lastId'), 'missing poll dedup');

  // auth: refresh + logout token
  assert('has /api/auth/refresh', h.includes('/api/auth/refresh'), 'missing');
  assert('logout sends refreshToken', h.includes('refreshToken:rt||\'\'') || h.includes('refreshToken:rt||""'), 'missing');
  assert('attaches Bearer via fetchAuth', h.includes("options.headers['Authorization']='Bearer '"), 'missing');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — API: unauth debug -> 401
// ═══════════════════════════════════════════════════════════════════════════
async function sectionUnauth() {
  console.log('\n── 6. Unauth debug APIs -> 401 ──');
  const eps = ['/api/debug/pipeline', '/api/debug/online', '/api/debug/latency', '/api/preview/credentials'];
  for (const ep of eps) {
    try {
      const r = await fj(`${BACKEND}${ep}`);
      assert(`${ep} -> 401`, r.s === 401, `got ${r.s}`);
    } catch (e) { sk(`${ep}`, `backend unreachable: ${e.message}`); }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — API: JWT viewer identity + chat consistency + safe JSON
// ═══════════════════════════════════════════════════════════════════════════
async function sectionAuthed() {
  console.log('\n── 7. Auth: JWT identity + chat consistency ──');
  const u = process.env.TEST_USERNAME, pw = process.env.TEST_PASSWORD;
  if (!u || !pw) { sk('authed API tests', 'no TEST_USERNAME/TEST_PASSWORD'); return; }

  const lg = await login(u, pw);
  if (lg.s !== 200) { sk('authed API tests', `login ${lg.s}`); return; }
  const token = lg.d.accessToken;
  const H = { Authorization: `Bearer ${token}` };
  console.log(`     logged in as ${lg.d.user?.username} (${lg.d.user?.role})`);

  // 7a. /api/auth/me returns full identity (username, role, employeeId, dept)
  const me = await fj(`${BACKEND}/api/auth/me`, { headers: H });
  assert('/api/auth/me -> 200', me.s === 200, `got ${me.s}`);
  if (me.s === 200) {
    assert('me.username present', !!me.d.username, JSON.stringify(me.d));
    assert('me.role present', !!me.d.role, JSON.stringify(me.d));
    assert('me.employeeId present', me.d.employeeId != null, JSON.stringify(me.d));
    assert('me.dept field present', 'dept' in me.d, JSON.stringify(me.d));
    assert('me does NOT expose passwordHash', !('passwordHash' in me.d), JSON.stringify(me.d));
  }

  // 7b. chat returns viewer from JWT (not body), provider/model, node counts, latency
  const chat = await fj(`${BACKEND}/api/chat`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ query: 'EMP002 คือใคร', conversationId: 'test-' + Date.now(), viewer: 'ceo' }), // spoof body viewer
  });
  assert('/api/chat -> 200', chat.s === 200, `got ${chat.s}`);
  if (chat.s === 200) {
    const d = chat.d;
    assert('viewer.username comes from JWT (not body spoof)',
      d.viewer && d.viewer.username === lg.d.user.username, `got ${JSON.stringify(d.viewer)}`);
    assert('viewer object has role', !!d.viewer?.role, JSON.stringify(d.viewer));
    assert('viewer object has employeeId', d.viewer?.employeeId != null, JSON.stringify(d.viewer));

    assert('provider present (non-empty)', typeof d.provider === 'string' && d.provider.length > 0, `got ${d.provider}`);
    assert('model present (non-empty)', typeof d.model === 'string' && d.model.length > 0, `got ${d.model}`);
    assert('answerSource is not hardcoded "gemini"', d.answerSource !== 'gemini', `answerSource=${d.answerSource}`);

    assert('totalNodes === 19', d.totalNodes === 19, `got ${d.totalNodes}`);
    assert('executedNodes is a positive number', typeof d.executedNodes === 'number' && d.executedNodes > 0, `got ${d.executedNodes}`);
    assert('executedNodes <= totalNodes', d.executedNodes <= d.totalNodes, `${d.executedNodes} > ${d.totalNodes}`);
    assert('route is a known value', ['sql', 'vector', 'keyword', 'template', 'cache', 'blocked', 'clarification'].includes(d.route), `got ${d.route}`);

    // trace timing: one consistent meaning (durationMs + elapsedMs), no legacy .ms
    const tr = d.trace || [];
    assert('trace has entries', tr.length > 0, 'empty');
    assert('trace entries use durationMs/elapsedMs', tr.every(t => 'durationMs' in t && 'elapsedMs' in t), 'legacy .ms found or missing field');
    assert('trace has no legacy .ms field', tr.every(t => !('ms' in t)), 'legacy .ms present');

    // route/trace consistency
    const nodes = tr.map(t => t.node);
    if (d.route === 'vector') assert('vector route -> trace has emb+vec', nodes.includes('emb') && nodes.includes('vec'), nodes.join(','));
    if (d.route === 'sql') assert('sql route -> trace has sqle', nodes.includes('sqle'), nodes.join(','));
    if (d.route === 'cache') assert('cache route -> trace has no llm', !nodes.includes('llm'), nodes.join(','));
    if (d.route === 'blocked') assert('blocked route -> trace stops at pol', nodes.length <= 2 && nodes.includes('pol') && !nodes.includes('llm'), nodes.join(','));
    assert('executedNodes matches unique trace nodes', d.executedNodes === new Set(nodes).size, `executedNodes=${d.executedNodes}, unique=${new Set(nodes).size}`);
  }

  // 7c. authenticated debug APIs return safe JSON (no password fields)
  const pl = await fj(`${BACKEND}/api/debug/pipeline`, { headers: H });
  assert('/api/debug/pipeline (auth) -> 200/404', pl.s === 200 || pl.s === 404, `got ${pl.s}`);
  if (pl.s === 200) assert('pipeline JSON has no passwordHash', !JSON.stringify(pl.d).includes('passwordHash'), 'leak');
  const on = await fj(`${BACKEND}/api/debug/online`, { headers: H });
  assert('/api/debug/online (auth) -> 200', on.s === 200, `got ${on.s}`);
  if (on.s === 200) assert('online JSON has no passwordHash', !JSON.stringify(on.d).includes('passwordHash'), 'leak');

  // 7d. blocked route end-to-end (only when an Employee test account is available)
  const creds = await fj(`${BACKEND}/api/preview/credentials`, { headers: H });
  if (creds.s === 200 && Array.isArray(creds.d)) {
    const emp = creds.d.find(c => c.role === 'Employee');
    if (emp && pw) {
      const el = await login(emp.username, pw);
      if (el.s === 200) {
        const bchat = await fj(`${BACKEND}/api/chat`, {
          method: 'POST', headers: { Authorization: `Bearer ${el.d.accessToken}` },
          body: JSON.stringify({ query: 'เงินเดือนของ EMP001 คือเท่าไหร่', conversationId: 'test-block-' + Date.now() }),
        });
        assert('Employee compensation chat -> 200', bchat.s === 200, `got ${bchat.s}`);
        if (bchat.s === 200) {
          assert('blocked route detected', bchat.d.route === 'blocked', `route=${bchat.d.route}`);
          const bn = (bchat.d.trace || []).map(t => t.node);
          assert('blocked trace stops at policy (no llm/search)', !bn.includes('llm') && !bn.includes('sqle') && !bn.includes('vec'), bn.join(','));
        }
      } else { sk('blocked route e2e', `employee login ${el.s}`); }
    } else { sk('blocked route e2e', 'no Employee account in preview credentials'); }
  } else { sk('blocked route e2e', `credentials ${creds.s}`); }
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('🧪 Debug RAG Inspector — focused test suite\n');
  await sectionScore();
  await sectionPolicy();
  await sectionProvider();
  sectionRelevance();
  sectionFrontendStatic();
  await sectionUnauth();
  await sectionAuthed();
  console.log(`\n📊 ${passed} passed, ${failed} failed, ${skipped} skipped / ${passed + failed + skipped} total`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error('Test harness error:', e.message); process.exit(1); });
