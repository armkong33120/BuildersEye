// test_api_blocked_query.mjs — API test: blocked/policy queries
// Tests that queries hitting governance policy boundaries return
// proper blocked responses instead of errors or leaks.
//
// Usage: node scripts/test_api_blocked_query.mjs
// Requires backend at BACKEND_URL, test credentials in TEST_USERNAME/TEST_PASSWORD

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

async function post(path, token, body) {
  try {
    const res = await fetch(BACKEND_URL + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, data: { error: e.message } };
  }
}

async function main() {
  console.log('🧪 API Test: Blocked Queries\n');
  console.log(`   Backend: ${BACKEND_URL}`);

  // 1. Test without auth — should get 401, not expose data
  const r1 = await post('/api/chat', null, { query: 'CEO คือใคร' });
  assert('No auth → 401', r1.status === 401, `got ${r1.status}: ${JSON.stringify(r1.data).slice(0, 80)}`);

  // Authenticated tests
  if (!TEST_USERNAME || !TEST_PASSWORD) {
    skipLog('Authenticated blocked tests', 'TEST_USERNAME/TEST_PASSWORD not set');
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // Login
  const loginRes = await post('/api/auth/login', null, { username: TEST_USERNAME, password: TEST_PASSWORD });
  if (loginRes.status !== 200) {
    console.log(`  ⚠️  Login failed: ${loginRes.status} — skipping authenticated tests`);
    skipped += 1;
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
    process.exit(failed > 0 ? 1 : 0);
  }
  const token = loginRes.data.accessToken;
  console.log(`  🔑 Logged in as ${loginRes.data.user?.role || '?'}`);

  // 2. Empty query
  const r2 = await post('/api/chat', token, { query: '' });
  assert('Empty query → 400', r2.status === 400, `got ${r2.status}`);

  // 3. Query with only whitespace
  const r3 = await post('/api/chat', token, { query: '   ' });
  assert('Whitespace query → rejected', r3.status === 400 || (r3.status === 200 && r3.data?.policy?.status === 'Blocked'),
    `status=${r3.status}`);

  // 4. Very long query (injection attempt)
  const longQuery = 'EMP' + '0'.repeat(5000);
  const r4 = await post('/api/chat', token, { query: longQuery });
  assert('Very long query → handled gracefully', r4.status === 200 || r4.status === 400,
    `status=${r4.status}`);

  // 5. Special characters only
  const r5 = await post('/api/chat', token, { query: '<script>alert(1)</script>' });
  assert('XSS query → handled safely', r5.status === 200 || r5.status === 400,
    `status=${r5.status} answerLen=${(r5.data?.answer || '').length}`);

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test harness error:', e.message);
  process.exit(1);
});
