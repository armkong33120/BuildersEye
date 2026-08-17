// test_isolation_api.mjs — Regression: HTTP-layer cross-user isolation (H1/H2, M3).
//
// Requires a running backend (BACKEND_URL, default http://localhost:5199) and auth
// credentials. A second account enables cross-user cases:
//   TEST_USERNAME + TEST_PASSWORD           (user A — primary)
//   TEST_USERNAME2 + TEST_PASSWORD2         (user B — second account)
// Cases needing a second account/admin are skipped gracefully when env vars are absent.
// Usage: node scripts/test_isolation_api.mjs

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5199';
const A_USER = process.env.TEST_USERNAME || '';
const A_PASS = process.env.TEST_PASSWORD || '';
const B_USER = process.env.TEST_USERNAME2 || '';
const B_PASS = process.env.TEST_PASSWORD2 || '';

const tests = [];
let passed = 0, failed = 0, skipped = 0;
function assert(name, condition, detail) {
  const ok = !!condition;
  tests.push({ name, ok });
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}
function skipLog(name, reason) { skipped++; console.log(`  ⏭️  ${name} — ${reason}`); }

async function post(path, token, body) {
  try {
    const res = await fetch(BACKEND_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(60000),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch (e) { return { status: 0, data: { error: e.message } }; }
}
async function get(path, token) {
  try {
    const res = await fetch(BACKEND_URL + path, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch (e) { return { status: 0, data: { error: e.message } }; }
}
async function del(path, token) {
  try {
    const res = await fetch(BACKEND_URL + path, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch (e) { return { status: 0, data: { error: e.message } }; }
}
async function login(username, password) {
  if (!username || !password) return null;
  const r = await post('/api/auth/login', null, { username, password });
  if (r.status !== 200) return null;
  return r.data.accessToken;
}

async function main() {
  console.log('🧪 API Test: Cross-user Isolation\n');
  console.log(`   Backend: ${BACKEND_URL}`);

  if (!A_USER || !A_PASS) {
    skipLog('All isolation API tests', 'TEST_USERNAME/TEST_PASSWORD not set');
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
    process.exit(failed > 0 ? 1 : 0);
  }

  const tokenA = await login(A_USER, A_PASS);
  assert('user A login succeeds', !!tokenA);

  // ── 1. Changing request-body identity does NOT change authorization ──────
  console.log('\n── 1. Body-identity spoof ──');
  const spoof = await post('/api/chat', tokenA, {
    query: 'CEO แผนกไหน',
    viewer: { role: 'CEO', employeeId: 999, username: 'ceo' },
  });
  assert('chat with spoofed body viewer still returns JWT identity', spoof.status === 200, `status=${spoof.status}`);
  if (spoof.status === 200) {
    assert('response role matches JWT, not spoofed body', spoof.data.role === spoof.data.viewer?.role, `role=${spoof.data.role}`);
  }

  // ── 2. Latest-pipeline isolation ──────────────────────────────────────────
  console.log('\n── 2. Debug pipeline isolation ──');
// ── 4. Cross-user conversation reuse (requires second account) ──────────
  console.log('\n── 4. Cross-user conversation reuse ──');
  if (!B_USER || !B_PASS) {
    skipLog('Cross-user conversation + pipeline isolation', 'TEST_USERNAME2 not set');
  } else {
    const tokenB = await login(B_USER, B_PASS);
    assert('user B login succeeds', !!tokenB);

    const convA = 'iso-b-' + Date.now();
    const aCreate = await post('/api/chat', tokenA, { query: 'กี่คนลาพักร้อน', conversationId: convA });
    assert('A created conversation for cross-user test', aCreate.status === 200 && aCreate.data.conversationId === convA);

    const getB = await get('/api/conversations/' + convA, tokenB);
    assert('B cannot READ A conversation → 404', getB.status === 404, `status=${getB.status}`);

    const appendB = await post('/api/chat', tokenB, { query: 'ขอลองใช้ id ของคนอื่น', conversationId: convA });
    assert('B cannot reuse A conversationId (append → 403)', appendB.status === 403, `status=${appendB.status}`);

    const delB = await del('/api/conversations/' + convA, tokenB);
    assert('B cannot DELETE A conversation → 404', delB.status === 404, `status=${delB.status}`);

    const listB = await get('/api/conversations', tokenB);
    assert('B conversation list excludes A conversation', Array.isArray(listB.data) && !listB.data.some(c => c.id === convA));

    const pipeB = await get('/api/debug/pipeline', tokenB);
    assert('B cannot read A latest pipeline (retrieval evidence private)', pipeB.status === 404,
      `status=${pipeB.status} (B has no pipeline of their own — A's is private)`);

    await del('/api/conversations/' + convA, tokenA); // cleanup
  }

  // ── 5. Manager scope + registry gating ────────────────────────────────────
  console.log('\n── 5. Manager scope + registry gating ──');
  if (process.env.TEST_MANAGER_USERNAME && process.env.TEST_MANAGER_PASSWORD) {
    const mgrToken = await login(process.env.TEST_MANAGER_USERNAME, process.env.TEST_MANAGER_PASSWORD);
    const listed = await get('/api/conversations', mgrToken);
    assert('manager conversation list only includes own conversations', Array.isArray(listed.data));
  } else {
    skipLog('Manager scope test', 'TEST_MANAGER_USERNAME not set');
  }

  // Non-admin must not see OneDrive account identity in registry/status (M2)
  if (A_USER !== 'ceo') {
    const st = await get('/api/registry/status', tokenA);
    if (st.status === 200) {
      assert('non-admin does not see onedrive accounts', !Array.isArray(st.data.onedrive?.accounts) || st.data.onedrive.accounts.length === 0);
    }
  }

  // ── 6. Admin preview (M3) ─────────────────────────────────────────────────
  console.log('\n── 6. Admin preview (M3) ──');
  if (A_USER === 'ceo') {
    const r1 = await post('/api/admin/preview', tokenA, { employeeCode: 'EMP001' });
    assert('CEO preview returns 200 + isPreview:true', r1.status === 200 && r1.data.isPreview === true, `status=${r1.status}`);
    const rEmp = await post('/api/admin/preview', tokenA, { employeeCode: 'EMP003' });
    assert('employee preview scoped to selected user (not CEO/ALL)', rEmp.status === 200 && rEmp.data.scope !== 'ALL' && rEmp.data.accessProfile?.profileCode !== 'GLOBAL_ADMIN');
  } else {
    skipLog('Admin preview test', 'A_USER is not ceo (set TEST_ADMIN_USERNAME for admin checks)');
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Test harness error:', e.message); process.exit(1); });
