// test_api_debug_auth.mjs — API test: debug endpoint authorization
// Tests that debug endpoints require valid authentication and
// return proper 401/403 for unauthorized requests.
//
// Tests:
//   1. /api/debug/pipeline without auth → 401
//   2. /api/debug/online without auth → 401
//   3. /api/debug/latency without auth → 401
//   4. /api/debug/pipeline with valid auth → 200 or 404
//   5. /api/debug/online with valid auth → 200
//   6. /api/debug/latency with valid auth → 200
//
// Usage: node scripts/test_api_debug_auth.mjs
// Requires: BACKEND_URL, TEST_USERNAME, TEST_PASSWORD (env vars)

import { BACKEND_URL, TEST_HTTP_TIMEOUT_MS } from './test_helpers.mjs';
const TEST_USERNAME = process.env.TEST_USERNAME || '';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';

const tests = [];
let passed = 0, failed = 0, skipped = 0;

function assert(name, condition, detail) {
  const ok = !!condition;
  tests.push({ name, ok, detail: detail || '' });
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}
function skipLog(name, reason) { skipped++; console.log(`  ⏭️  ${name} — ${reason}`); }

async function get(path, token) {
  try {
    const res = await fetch(BACKEND_URL + path, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, data: { error: e.message } };
  }
}

async function main() {
  console.log('🧪 API Test: Debug Endpoint Authorization\n');
  console.log(`   Backend: ${BACKEND_URL}`);

  // ── Without auth ──
  console.log('\n  ── Without Authentication ──');
  const r1 = await get('/api/debug/pipeline', null);
  assert('GET /api/debug/pipeline (no auth) → 401', r1.status === 401,
    `got ${r1.status}`);

  const r2 = await get('/api/debug/online', null);
  assert('GET /api/debug/online (no auth) → 401', r2.status === 401,
    `got ${r2.status}`);

  const r3 = await get('/api/debug/latency', null);
  assert('GET /api/debug/latency (no auth) → 401', r3.status === 401,
    `got ${r3.status}`);

  // ── With auth ──
  if (!TEST_USERNAME || !TEST_PASSWORD) {
    skipLog('Authenticated debug tests', 'TEST_USERNAME/TEST_PASSWORD not set');
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
    process.exit(failed > 0 ? 1 : 0);
  }

  console.log('\n  ── With Authentication ──');
  // Login
  const loginRes = await fetch(BACKEND_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    signal: AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS),
  });
  if (loginRes.status !== 200) {
    console.log(`  ⚠️  Login failed: ${loginRes.status}`);
    process.exit(0);
  }
  const loginData = await loginRes.json();
  const token = loginData.accessToken;
  console.log(`  🔑 Logged in as ${loginData.user?.role || '?'}`);

  const r4 = await get('/api/debug/pipeline', token);
  assert('GET /api/debug/pipeline (auth) → 200 or 404', r4.status === 200 || r4.status === 404,
    `got ${r4.status} (200=has data, 404=no pipeline yet)`);

  const r5 = await get('/api/debug/online', token);
  assert('GET /api/debug/online (auth) → 200', r5.status === 200,
    `got ${r5.status}, count=${r5.data.count}`);

  const r6 = await get('/api/debug/latency', token);
  assert('GET /api/debug/latency (auth) → 200', r6.status === 200,
    `got ${r6.status}, pipeline=${JSON.stringify(r6.data.pipeline)}`);

  // Verify latency data structure
  if (r6.status === 200) {
    assert('Latency has pipeline stats', typeof r6.data.pipeline === 'object',
      `pipeline=${JSON.stringify(r6.data.pipeline)}`);
    assert('Latency pipeline.samples is number',
      typeof r6.data.pipeline.samples === 'number',
      `samples=${r6.data.pipeline.samples}`);
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test harness error:', e.message);
  process.exit(1);
});
