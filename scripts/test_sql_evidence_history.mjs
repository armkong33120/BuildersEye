// test_sql_evidence_history.mjs — Focused regression tests for SQL evidence
// correctness and chat-history rendering safety.
//
// Covers (unit, no backend):
//   1. buildSqlEvidence: evidence from REAL SQL output only (source/metric/
//      rowCount/fields/values), no fabricated source/sheet/field/employeeId/
//      score/snippet, and an explicit unavailable state when metadata is absent.
//   2. buildRetrievalEvidence: non-SQL routes still return retrieval evidence.
//   3. History helpers (public/debug-history.js): object viewer → readable
//      string (never [object Object]), dedup by stable id, same-text/different-id
//      preserved, cap 50.
//   4. Frontend static: SQL evidence branch + safe history rendering present.
//
// Covers (integration, skipped without BACKEND creds):
//   5. SQL route → retrievalEvidence empty + sqlEvidence present; non-SQL route
//      → retrievalEvidence preserved + sqlEvidence null.
//
// Usage: node scripts/test_sql_evidence_history.mjs
// Env:   BACKEND_URL TEST_USERNAME TEST_PASSWORD

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BACKEND_URL as BACKEND, TEST_HTTP_TIMEOUT_MS } from './test_helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0, skipped = 0;
const assert = (name, cond, detail) => { if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name} — ${detail}`); } };
const sk = (name, reason) => { skipped++; console.log(`  ⏭️  ${name} — ${reason}`); };
const read = (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } };

async function fj(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, signal: opts.signal || AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS) });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = null; }
  return { s: r.status, d, t };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — buildSqlEvidence (unit)
// ═══════════════════════════════════════════════════════════════════════════
async function sectionSqlEvidence() {
  console.log('\n── 1. buildSqlEvidence (unit) ──');
  let build;
  try { ({ buildSqlEvidence: build } = await import('../server/chatController.js')); }
  catch (e) { sk('buildSqlEvidence (import)', e.message); return; }

  const SQL_KEYS = ['source', 'status', 'metric', 'sql', 'rowCount', 'fields', 'values'];

  // 1a. real SQL output → evidence built ONLY from that output
  const sqlRes = { sql: "SELECT AVG(CAST(content AS FLOAT)) AS avg_salary FROM employee_data WHERE sheetName='Salary_History'", data: [{ avg_salary: 52300 }], error: null };
  const safeData = [{ avg_salary: 52300 }];
  const ev = build(sqlRes, safeData);
  assert('SQL evidence source is sql-analytics', ev.source === 'sql-analytics', JSON.stringify(ev));
  assert('metric detected (AVG)', ev.metric === 'AVG', `metric=${ev.metric}`);
  assert('rowCount from real output', ev.rowCount === 1, `rowCount=${ev.rowCount}`);
  assert('fields from real output columns', Array.isArray(ev.fields) && ev.fields.includes('avg_salary'), JSON.stringify(ev.fields));
  assert('values contain authorized result values', Array.isArray(ev.values) && ev.values.length === 1 && ev.values[0].avg_salary === 52300, JSON.stringify(ev.values));
  assert('keys within allowed set (no fabricated sheet/field/employeeId/score/snippet)', Object.keys(ev).every((k) => SQL_KEYS.includes(k)), JSON.stringify(ev));

  // 1b. no safe SQL metadata → explicit unavailable state, empty values
  const un = build({ sql: '', data: null, error: 'LLM not available' }, null);
  assert('unavailable state has status unavailable', un.status === 'unavailable', JSON.stringify(un));
  assert('unavailable state has empty values', Array.isArray(un.values) && un.values.length === 0, JSON.stringify(un.values));
  assert('unavailable state has no fabricated metric', un.metric === null, JSON.stringify(un.metric));
  const un2 = build(null, null);
  assert('null sqlRes → unavailable', un2.status === 'unavailable', JSON.stringify(un2));

  // 1c. COUNT(DISTINCT) metric detection
  const count = build({ sql: 'SELECT COUNT(DISTINCT employeeId) AS c FROM employee_data', data: [{ c: 42 }] }, [{ c: 42 }]);
  assert('COUNT metric detected', count.metric === 'COUNT', `metric=${count.metric}`);

  // 1d. no fabricated retrieval fields on SQL evidence
  const ev2 = build(sqlRes, safeData);
  assert('SQL evidence has no "sheet" field', !('sheet' in ev2), JSON.stringify(ev2));
  assert('SQL evidence has no "field" field', !('field' in ev2), JSON.stringify(ev2));
  assert('SQL evidence has no "employeeId" field', !('employeeId' in ev2), JSON.stringify(ev2));
  assert('SQL evidence has no "score" field', !('score' in ev2), JSON.stringify(ev2));
  assert('SQL evidence has no "snippet" field', !('snippet' in ev2), JSON.stringify(ev2));
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — buildRetrievalEvidence still works for non-SQL (unit)
// ═══════════════════════════════════════════════════════════════════════════
async function sectionRetrievalEvidence() {
  console.log('\n── 2. buildRetrievalEvidence (non-SQL unchanged) ──');
  let build;
  try { ({ buildRetrievalEvidence: build } = await import('../server/chatController.js')); }
  catch (e) { sk('buildRetrievalEvidence (import)', e.message); return; }
  const results = [
    { employeeId: 1, score: 100, matchedRecords: [{ fileName: 'EMP001_OneDrive_Profile.xlsx', sheetName: 'Employee_Profile', fieldName: 'name', content: 'ธนกฤต ศรีสุวรรณ' }] },
  ];
  const ev = build(results, [], 10);
  assert('non-SQL retrieval evidence still produced', Array.isArray(ev) && ev.length === 1, JSON.stringify(ev));
  assert('retrieval evidence has source', ev[0].source === 'EMP001_OneDrive_Profile.xlsx', JSON.stringify(ev[0]));
  assert('retrieval evidence has snippet', typeof ev[0].snippet === 'string', JSON.stringify(ev[0]));
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — History helpers (unit, from public/debug-history.js)
// ═══════════════════════════════════════════════════════════════════════════
async function sectionHistoryHelpers() {
  console.log('\n── 3. History helpers (actor/viewer + dedup) ──');
  let VU;
  try {
    await import('../public/debug-history.js');
    VU = globalThis.ViewerUtils;
  } catch (e) { sk('history helpers (import public/debug-history.js)', e.message); return; }
  if (!VU) { sk('history helpers', 'globalThis.ViewerUtils not set'); return; }

  // 3a. object viewer/user data renders as a readable string (never [object Object])
  assert('object {username,role} → readable', VU.actorString({ username: 'emp144', role: 'Employee' }) === 'emp144 · Employee', JSON.stringify(VU.actorString({ username: 'emp144', role: 'Employee' })));
  assert('object {username} → "it-manager"', VU.actorString({ username: 'it-manager' }) === 'it-manager', '');
  assert('object {role} → "Employee"', VU.actorString({ role: 'Employee' }) === 'Employee', '');
  assert('string "employee" passes through', VU.actorString('employee') === 'employee', '');
  assert('redundant role (ceo/CEO) collapsed to "ceo"', VU.actorString({ username: 'ceo', role: 'CEO' }) === 'ceo', JSON.stringify(VU.actorString({ username: 'ceo', role: 'CEO' })));
  assert('null → ""', VU.actorString(null) === '', '');
  const objLabel = VU.actorString({ username: 'ceo', role: 'CEO', employeeId: 1, department: 'Executive', name: 'X' });
  assert('never renders [object Object]', !objLabel.includes('[object Object]'), objLabel);

  // 3b. viewerLabel pulls from d.viewer (JWT identity) and falls back safely
  assert('viewerLabel from d.viewer object', VU.viewerLabel({ viewer: { username: 'ceo', role: 'CEO' } }) === 'ceo', JSON.stringify(VU.viewerLabel({ viewer: { username: 'ceo', role: 'CEO' } })));
  assert('viewerLabel fallback when empty', VU.viewerLabel({}) === '—', JSON.stringify(VU.viewerLabel({})));
  assert('viewerLabel uses provided fallback', VU.viewerLabel({}, 'employee') === 'employee', '');

  // 3c. dedup by stable id
  const a = { id: 'pl-1', query: 'Coo คือใคร', viewer: { username: 'ceo', role: 'CEO' } };
  const b = { id: 'pl-1', query: 'Coo คือใคร', viewer: { username: 'ceo', role: 'CEO' } };
  const dup = VU.dedupeHistory([a], b, 50);
  assert('duplicate stable id removed (returns null)', dup === null, JSON.stringify(dup));

  // 3d. same query text, different ids → both preserved
  const c = { id: 'pl-2', query: 'Coo คือใคร', viewer: 'ceo' };
  const both = VU.dedupeHistory([a], c, 50);
  assert('same text, different id preserved', Array.isArray(both) && both.length === 2 && both[0].id === 'pl-2' && both[1].id === 'pl-1', JSON.stringify(both && both.map((e) => e.id)));

  // 3e. cap at 50
  const many = Array.from({ length: 60 }, (_, i) => ({ id: 'id-' + i, query: 'q' + i, viewer: 'ceo' }));
  const capped = VU.normalizeHistory(many, 50);
  assert('history capped at 50', Array.isArray(capped) && capped.length === 50, `got ${capped && capped.length}`);

  // 3f. normalizeHistory coerces legacy object viewer + removes duplicate ids
  const legacy = [
    { id: 'x', query: 'Coo คือใคร', viewer: { username: 'ceo', role: 'CEO' } },
    { id: 'x', query: 'Coo คือใคร', viewer: { username: 'ceo', role: 'CEO' } },
  ];
  const norm = VU.normalizeHistory(legacy, 50);
  assert('legacy duplicate ids removed', norm.length === 1, JSON.stringify(norm.map((e) => e.id)));
  assert('legacy object viewer normalized to string', typeof norm[0].viewer === 'string' && !norm[0].viewer.includes('[object Object]'), JSON.stringify(norm[0].viewer));
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — Frontend static (debug page)
// ═══════════════════════════════════════════════════════════════════════════
function sectionFrontendStatic() {
  console.log('\n── 4. Frontend static (debug page) ──');
  const h = read(path.join(ROOT, 'debug_neural_network_diagram.html'));
  assert('loads shared debug-history.js', h.includes('src="./debug-history.js"'), 'missing script tag');
  assert('SQL evidence branch present', h.includes('SQL Evidence'), 'missing SQL Evidence label');
  assert('SQL unavailable state present', h.includes('SQL result evidence unavailable'), 'missing unavailable state');
  assert('retrieval evidence preserved for non-SQL', h.includes('Retrieval Evidence ('), 'missing');
  assert('history dedups by stable id', h.includes('VU.stableId') && h.includes('h.some(e=>e.id===id)'), 'missing');
  assert('history never renders raw viewer object (uses actorString)', h.includes('VU.actorString(e.viewer)'), 'missing');
  assert('history capped at 50', h.includes('slice(0,50)'), 'missing');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — API integration (requires backend + creds)
// ═══════════════════════════════════════════════════════════════════════════
async function sectionApi() {
  console.log('\n── 5. API integration ──');
  const u = process.env.TEST_USERNAME, pw = process.env.TEST_PASSWORD;
  if (!u || !pw) { sk('API integration', 'no TEST_USERNAME/TEST_PASSWORD'); return; }
  const login = await fj(`${BACKEND}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username: u, password: pw }) });
  if (login.s !== 200) { sk('API integration', `login ${login.s}`); return; }
  const H = { Authorization: `Bearer ${login.d.accessToken}` };
  async function chat(q) { return fj(`${BACKEND}/api/chat`, { method: 'POST', headers: H, body: JSON.stringify({ query: q, conversationId: 't-sqlhist-' + Date.now() }) }); }

  // 5a. analytics → SQL route shows SQL evidence, NOT keyword/vector evidence
  const a = await chat('ค่าเฉลี่ยเงินเดือนของพนักงานทั้งหมดเท่าไหร่');
  assert('analytics chat -> 200', a.s === 200, `got ${a.s}`);
  if (a.s === 200 && a.d.route === 'sql') {
    assert('SQL route -> retrievalEvidence empty (no keyword chunks as SQL evidence)', Array.isArray(a.d.retrievalEvidence) && a.d.retrievalEvidence.length === 0, JSON.stringify(a.d.retrievalEvidence));
    assert('SQL route -> sqlEvidence present', a.d.sqlEvidence && typeof a.d.sqlEvidence === 'object', JSON.stringify(a.d.sqlEvidence));
    if (a.d.sqlEvidence) {
      assert('sqlEvidence.source === sql-analytics', a.d.sqlEvidence.source === 'sql-analytics', JSON.stringify(a.d.sqlEvidence.source));
      assert('sqlEvidence.values is array', Array.isArray(a.d.sqlEvidence.values), JSON.stringify(a.d.sqlEvidence.values));
      const keyOk = Object.keys(a.d.sqlEvidence).every((k) => ['source', 'status', 'metric', 'sql', 'rowCount', 'fields', 'values'].includes(k));
      assert('sqlEvidence has no fabricated retrieval fields', keyOk, JSON.stringify(a.d.sqlEvidence));
    }
  } else if (a.s === 200) {
    sk('SQL route evidence assertions', `route=${a.d.route} (not sql)`);
  }

  // 5b. identity → non-SQL route keeps retrieval evidence, sqlEvidence null
  const b = await chat('EMP002 คือใคร');
  assert('identity chat -> 200', b.s === 200, `got ${b.s}`);
  if (b.s === 200) {
    assert('non-SQL route -> sqlEvidence null', b.d.sqlEvidence == null, JSON.stringify(b.d.sqlEvidence));
    assert('non-SQL route -> retrievalEvidence is array', Array.isArray(b.d.retrievalEvidence), JSON.stringify(b.d.retrievalEvidence));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('🧪 SQL evidence + history rendering — focused regression tests\n');
  await sectionSqlEvidence();
  await sectionRetrievalEvidence();
  await sectionHistoryHelpers();
  sectionFrontendStatic();
  await sectionApi();
  console.log(`\n📊 ${passed} passed, ${failed} failed, ${skipped} skipped / ${passed + failed + skipped} total`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Test harness error:', e.message); process.exit(1); });

