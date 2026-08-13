// test_sql_metadata_evidence.mjs — Focused tests for SQL metadata, execution
// counting, and safe retrieval evidence.
//
// Covers:
//   1. buildRetrievalEvidence (unit): source/sheet/field/employeeId/score/snippet
//      only when actually available; snippet omitted when redacted
//   2. sqlRouting detection (unit)
//   3. API (integration, skipped without BACKEND creds): sqlDetected/sqlAttempted/
//      sqlSucceeded/fallbackRoute consistency, executedEntries/uniqueExecutedNodes
//      vs totalNodes=19, retrievalEvidence shape + no redacted leaks
//
// Usage: node scripts/test_sql_metadata_evidence.mjs
// Env:   BACKEND_URL TEST_USERNAME TEST_PASSWORD

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5199';
const TEST_USERNAME = process.env.TEST_USERNAME || '';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';

let passed = 0, failed = 0, skipped = 0;
const assert = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
};
const sk = (name, reason) => { skipped++; console.log(`  ⏭️  ${name} — ${reason}`); };

const EVIDENCE_KEYS = ['source', 'sheet', 'field', 'employeeId', 'score', 'snippet'];

async function fj(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = null; }
  return { s: r.status, d, t };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — buildRetrievalEvidence (unit)
// ═══════════════════════════════════════════════════════════════════════════
async function sectionEvidence() {
  console.log('\n── 1. buildRetrievalEvidence (unit) ──');
  let build;
  try { ({ buildRetrievalEvidence: build } = await import('../server/chatController.js')); }
  catch (e) { sk('buildRetrievalEvidence (import)', e.message); return; }

  const results = [
    {
      employeeId: 1, score: 100,
      matchedRecords: [{ fileName: 'EMP001_OneDrive_Profile.xlsx', sheetName: 'Employee_Profile', fieldName: 'name', content: 'ธนกฤต ศรีสุวรรณ' }],
    },
    {
      employeeId: 2, score: 0.91,
      matchedRecords: [{ fileName: 'EMP002_OneDrive_Profile.xlsx', sheetName: 'Employee_Profile', fieldName: 'mainWeakness', content: '[Redacted — Policy]', redacted: true }],
    },
    { employeeId: 3, score: 55, matchedRecords: [] },
  ];
  const ev = build(results, [], 10);

  assert('returns array of 3', Array.isArray(ev) && ev.length === 3, `got ${JSON.stringify(ev)}`);
  assert('ev[0] has source', ev[0].source === 'EMP001_OneDrive_Profile.xlsx', JSON.stringify(ev[0]));
  assert('ev[0] has sheet', ev[0].sheet === 'Employee_Profile', JSON.stringify(ev[0]));
  assert('ev[0] has field', ev[0].field === 'name', JSON.stringify(ev[0]));
  assert('ev[0] has employeeId', ev[0].employeeId === 1, JSON.stringify(ev[0]));
  assert('ev[0] has score', ev[0].score === 100, JSON.stringify(ev[0]));
  assert('ev[0] has snippet (not redacted)', typeof ev[0].snippet === 'string' && ev[0].snippet.includes('ธนกฤต'), JSON.stringify(ev[0]));

  assert('ev[1] omits snippet when redacted', ev[1].snippet === undefined, JSON.stringify(ev[1]));
  assert('ev[1] still has source/sheet/field', ev[1].source && ev[1].sheet && ev[1].field, JSON.stringify(ev[1]));

  assert('ev[2] only has employeeId+score (no fabricated fields)', ev[2].employeeId === 3 && ev[2].score === 55 && ev[2].source === undefined && ev[2].snippet === undefined, JSON.stringify(ev[2]));

  const keyOk = ev.every((e) => Object.keys(e).every((k) => EVIDENCE_KEYS.includes(k)));
  assert('evidence keys are within the allowed set', keyOk, JSON.stringify(ev));

  assert('limit param respected', build(results, [], 2).length === 2, `got ${build(results, [], 2).length}`);

  const noFile = [{ employeeId: 1, score: 99, matchedRecords: [{ sheetName: 'X', fieldName: 'Y', content: 'hello' }] }];
  const srcs = [{ fileName: 'EMP001_OneDrive_Profile.xlsx' }];
  assert('source resolved from sources fallback', build(noFile, srcs, 10)[0].source === 'EMP001_OneDrive_Profile.xlsx', JSON.stringify(build(noFile, srcs, 10)));

  assert('empty input -> empty array', Array.isArray(build([], [], 10)) && build([], [], 10).length === 0, 'non-empty');
  assert('null input -> empty array', Array.isArray(build(null, null, 10)) && build(null, null, 10).length === 0, 'non-empty');
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — SQL routing detection (unit)
// ═══════════════════════════════════════════════════════════════════════════
async function sectionRouting() {
  console.log('\n── 2. SQL routing detection (unit) ──');
  let detect, qualitative;
  try {
    ({ detectSqlAnalyticsIntent: detect, isQualitativeQuery: qualitative } = await import('../server/sqlRouting.js'));
  } catch (e) { sk('sqlRouting (import)', e.message); return; }

  assert('analytics query detected', detect('ค่าเฉลี่ยเงินเดือนของพนักงานทั้งหมด') === true, 'false');
  assert('identity query not detected', detect('EMP001 คือใคร') === false, 'true');
  assert('qualitative query not routed to SQL', detect('ปัญหาความเสี่ยงของวิศวกร') === false, 'true');
  assert('isQualitativeQuery flags qualitative', qualitative('ปัญหาความเสี่ยงของวิศวกร') === true, 'false');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — API integration (requires backend + creds)
// ═══════════════════════════════════════════════════════════════════════════
async function sectionApi() {
  console.log('\n── 3. API integration ──');
  if (!TEST_USERNAME || !TEST_PASSWORD) {
    sk('API integration', 'TEST_USERNAME/TEST_PASSWORD not set');
    return;
  }

  const login = await fj(`${BACKEND}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }) });
  if (login.s !== 200) { sk('API integration', `login failed ${login.s}`); return; }
  const token = login.d.accessToken;
  const H = { Authorization: `Bearer ${token}` };
  console.log(`  🔑 role=${login.d.user?.role}`);

  async function chat(query) {
    // Cache-bust: the response cache is keyed on normalized query + role, so an
    // identical query in a warm cache returns route=cache (sqlAttempted=false).
    // Append a unique nonce so this test always exercises the real SQL path.
    const q = query + ' ' + Math.random().toString(36).slice(2, 8);
    return fj(`${BACKEND}/api/chat`, { method: 'POST', headers: H, body: JSON.stringify({ query: q, conversationId: 't-sqlmeta-' + Date.now() }) });
  }

  // 3a. analytics query → SQL lifecycle populated + consistent
  const a = await chat('ค่าเฉลี่ยเงินเดือนของพนักงานทั้งหมดเท่าไหร่');
  assert('analytics chat -> 200', a.s === 200, `got ${a.s}`);
  if (a.s === 200) {
    const d = a.d;
    assert('sqlDetected is boolean', typeof d.sqlDetected === 'boolean', typeof d.sqlDetected);
    assert('sqlAttempted is boolean', typeof d.sqlAttempted === 'boolean', typeof d.sqlAttempted);
    assert('sqlSucceeded is boolean', typeof d.sqlSucceeded === 'boolean', typeof d.sqlSucceeded);
    assert('fallbackRoute is null or string', d.fallbackRoute === null || typeof d.fallbackRoute === 'string', JSON.stringify(d.fallbackRoute));
    assert('analytics query -> sqlDetected true', d.sqlDetected === true, `sqlDetected=${d.sqlDetected}`);
    assert('analytics query -> sqlAttempted true', d.sqlAttempted === true, `sqlAttempted=${d.sqlAttempted}`);
    assert('sqlSucceeded <=> sqlUsed consistency', d.sqlSucceeded === !!d.sqlUsed, `sqlSucceeded=${d.sqlSucceeded} sqlUsed=${d.sqlUsed}`);
    if (d.sqlUsed) assert('SQL success -> no fallbackRoute', d.fallbackRoute === null, JSON.stringify(d.fallbackRoute));
  }

  // 3b. identity query → no SQL
  const b = await chat('EMP001 คือใคร');
  assert('identity chat -> 200', b.s === 200, `got ${b.s}`);
  if (b.s === 200) {
    assert('identity -> sqlDetected false', b.d.sqlDetected === false, `sqlDetected=${b.d.sqlDetected}`);
    assert('identity -> sqlAttempted false', b.d.sqlAttempted === false, `sqlAttempted=${b.d.sqlAttempted}`);
    assert('identity -> sqlSucceeded false', b.d.sqlSucceeded === false, `sqlSucceeded=${b.d.sqlSucceeded}`);
    assert('identity -> fallbackRoute null', b.d.fallbackRoute === null, JSON.stringify(b.d.fallbackRoute));
  }

  // 3c. execution counting invariants
  const sample = (a.s === 200) ? a.d : (b.s === 200 ? b.d : null);
  if (sample) {
    const trace = Array.isArray(sample.trace) ? sample.trace : [];
    assert('executedEntries === trace.length', sample.executedEntries === trace.length, `executedEntries=${sample.executedEntries} trace=${trace.length}`);
    assert('uniqueExecutedNodes === unique trace nodes', sample.uniqueExecutedNodes === new Set(trace.map((t) => t.node)).size, `uniqueExecutedNodes=${sample.uniqueExecutedNodes}`);
    assert('executedNodes === uniqueExecutedNodes', sample.executedNodes === sample.uniqueExecutedNodes, `${sample.executedNodes} vs ${sample.uniqueExecutedNodes}`);
    assert('totalNodes === 19', sample.totalNodes === 19, `got ${sample.totalNodes}`);
    assert('uniqueExecutedNodes <= totalNodes', sample.uniqueExecutedNodes <= sample.totalNodes, `${sample.uniqueExecutedNodes} > ${sample.totalNodes}`);
    assert('executedEntries >= uniqueExecutedNodes (repeated phases visible)', sample.executedEntries >= sample.uniqueExecutedNodes, `${sample.executedEntries} < ${sample.uniqueExecutedNodes}`);
  }

  // 3d. retrieval evidence shape + safety
  const evSample = (a.s === 200 && Array.isArray(a.d.retrievalEvidence)) ? a.d.retrievalEvidence : (b.s === 200 && Array.isArray(b.d.retrievalEvidence) ? b.d.retrievalEvidence : null);
  if (evSample) {
    assert('retrievalEvidence is an array', Array.isArray(evSample), typeof evSample);
    const keyOk = evSample.every((e) => Object.keys(e).every((k) => EVIDENCE_KEYS.includes(k)));
    assert('retrievalEvidence keys within allowed set', keyOk, JSON.stringify(evSample.slice(0, 2)));
    const noRedactedLeak = evSample.every((e) => !e.snippet || !/^\[Redacted/.test(e.snippet));
    assert('no redacted snippet leaks', noRedactedLeak, JSON.stringify(evSample.slice(0, 2)));
  } else {
    sk('retrieval evidence shape', 'no evidence available in sample responses');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('🧪 SQL metadata + execution counting + retrieval evidence — focused tests\n');
  await sectionEvidence();
  await sectionRouting();
  await sectionApi();
  console.log(`\n📊 ${passed} passed, ${failed} failed, ${skipped} skipped / ${passed + failed + skipped} total`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Test harness error:', e.message); process.exit(1); });
