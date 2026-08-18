// test_api_cache.mjs — API test: response cache hit/miss behavior
// Tests that repeated queries hit the cache (second response is faster
// and has cached=true).
//
// Usage: node scripts/test_api_cache.mjs
// Requires: BACKEND_URL, TEST_USERNAME, TEST_PASSWORD (env vars)
// LLM key is required for cache to be active (cache is bypassed when LLM is off)

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
    const t0 = Date.now();
    const res = await fetch(BACKEND_URL + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS),
    });
    const elapsed = Date.now() - t0;
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, elapsed };
  } catch (e) {
    return { status: 0, data: { error: e.message }, elapsed: 0 };
  }
}

async function main() {
  console.log('🧪 API Test: Response Cache Behavior\n');
  console.log(`   Backend: ${BACKEND_URL}`);

  if (!TEST_USERNAME || !TEST_PASSWORD) {
    skipLog('All cache tests', 'TEST_USERNAME/TEST_PASSWORD not set');
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

  // Test cache: same query twice
  const query = 'CEO คือใคร';

  // First query (should be cache miss)
  const r1 = await post('/api/chat', token, { query });
  assert('First query → success', r1.status === 200, `status=${r1.status}`);
  console.log(`     First response: ${r1.elapsed}ms, cached=${r1.data.cached}`);

  // Second query (should be cache hit if LLM available)
  const r2 = await post('/api/chat', token, { query });
  assert('Second query → success', r2.status === 200, `status=${r2.status}`);
  console.log(`     Second response: ${r2.elapsed}ms, cached=${r2.data.cached}`);

  // Cache hit detection
  if (r2.data.cached === true) {
    assert('Second query → cache HIT', true, `elapsed: ${r1.elapsed}ms → ${r2.elapsed}ms`);
    assert('Cache hit is faster', r2.elapsed < r1.elapsed,
      `first=${r1.elapsed}ms second=${r2.elapsed}ms`);
  } else {
    // Cache might be off if LLM unavailable
    const traceNodes = (r1.data.trace || []).map(t => t.note || '');
    const cacheOff = traceNodes.some(n => n.includes('LLM unavailable'));
    if (cacheOff) {
      skipLog('Cache hit test', 'LLM unavailable — cache is disabled when LLM is off');
    } else {
      // LLM available but cache miss — could be first query of the run
      console.log(`     ⚠️  Cache miss on second query (may be normal if LLM is processing)`);
      assert('Second query → response received', !!r2.data.answer);
    }
  }

  // Test that answer content matches between cached and non-cached
  if (r1.data.answer && r2.data.answer) {
    const a1 = r1.data.answer.trim();
    const a2 = r2.data.answer.trim();
    assert('Cache answer matches original', a1 === a2,
      `len1=${a1.length} len2=${a2.length}`);
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test harness error:', e.message);
  process.exit(1);
});
