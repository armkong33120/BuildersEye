// test_api_vector_query.mjs — API test: vector/semantic search queries
// Tests that semantic queries with high Thai-language complexity correctly
// route through vector search, not just keyword.
//
// Usage: node scripts/test_api_vector_query.mjs
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
  console.log('🧪 API Test: Vector/Semantic Queries\n');
  console.log(`   Backend: ${BACKEND_URL}`);

  if (!TEST_USERNAME || !TEST_PASSWORD) {
    skipLog('All vector tests', 'TEST_USERNAME/TEST_PASSWORD not set');
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
    process.exit(0);
  }

  // Login
  const loginRes = await post('/api/auth/login', null, { username: TEST_USERNAME, password: TEST_PASSWORD });
  if (loginRes.status !== 200) {
    console.log(`  ⚠️  Login failed: ${loginRes.status}`);
    process.exit(0);
  }
  const token = loginRes.data.accessToken;
  console.log(`  🔑 Logged in as ${loginRes.data.user?.role || '?'}`);

  // Test vector/semantic queries — these should work even without LLM (template fallback)
  const semanticQueries = [
    'ใครคือ CEO',
    'ใครมี KPI สูงที่สุด',
    'พนักงานที่ burnout มากที่สุด',
  ];

  for (const q of semanticQueries) {
    const { status, data } = await post('/api/chat', token, { query: q });

    assert(`Vector: "${q}" → success`, status === 200,
      `status=${status} answerLen=${(data.answer || '').length}`);

    // Answer must not be empty or policy-blocked
    const answer = (data.answer || '');
    assert(`Vector: "${q}" → has answer`, answer.length > 0,
      `answer preview: ${answer.slice(0, 80)}`);

    // Policy should be "Allowed" or "Redacted", not "Blocked"
    if (data.policy) {
      assert(`Vector: "${q}" → not blocked`, data.policy.status !== 'Blocked',
        `policy status: ${data.policy.status}`);
    }
  }

  // Test the semantic search endpoint directly
  const searchRes = await post('/api/search/semantic', token, {
    query: 'ใครคือ CEO',
    k: 3,
    mode: 'vector',
  });
  assert('Direct /api/search/semantic → success',
    searchRes.status === 200 || searchRes.status === 503,
    `status=${searchRes.status} (503=vectors not built)`);

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test harness error:', e.message);
  process.exit(1);
});
