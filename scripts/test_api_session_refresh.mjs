// test_api_session_refresh.mjs — API test: JWT session refresh flow
// Tests the complete auth lifecycle:
//   1. Login → get accessToken + refreshToken
//   2. Validate accessToken via /api/auth/me
//   3. Refresh → get new accessToken + refreshToken
//   4. Old refreshToken should be revoked (can't reuse)
//   5. New accessToken should work
//   6. Logout → refreshToken revoked
//   7. Refresh after logout → 401
//
// Usage: node scripts/test_api_session_refresh.mjs
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

async function api(method, path, token, body) {
  try {
    const res = await fetch(BACKEND_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, data: { error: e.message } };
  }
}

async function main() {
  console.log('🧪 API Test: Session Refresh Flow\n');
  console.log(`   Backend: ${BACKEND_URL}`);

  if (!TEST_USERNAME || !TEST_PASSWORD) {
    skipLog('All session tests', 'TEST_USERNAME/TEST_PASSWORD not set');
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
    process.exit(0);
  }

  // 1. Login
  const login1 = await api('POST', '/api/auth/login', null, {
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
  });
  assert('Login → 200', login1.status === 200,
    `got ${login1.status}: ${login1.data.error || ''}`);

  if (login1.status !== 200) {
    console.log('  ⚠️  Cannot proceed without successful login');
    process.exit(1);
  }

  const { accessToken, refreshToken } = login1.data;
  assert('Login returns accessToken', !!accessToken);
  assert('Login returns refreshToken', !!refreshToken);
  console.log(`  🔑 Got tokens (access: ${accessToken.slice(0, 20)}..., refresh: ${refreshToken.slice(0, 20)}...)`);

  // 2. Validate access token
  const me = await api('GET', '/api/auth/me', accessToken, null);
  assert('GET /api/auth/me → 200', me.status === 200,
    `got ${me.status}`);
  assert('/api/auth/me returns user', !!me.data.username || !!me.data.role,
    `data: ${JSON.stringify(me.data).slice(0, 80)}`);

  // 3. Test with invalid token
  const badMe = await api('GET', '/api/auth/me', 'invalid-token-12345', null);
  assert('GET /api/auth/me with bad token → 401', badMe.status === 401,
    `got ${badMe.status}`);

  // 4. Refresh tokens
  const refresh1 = await api('POST', '/api/auth/refresh', null, { refreshToken });
  assert('Refresh → 200', refresh1.status === 200,
    `got ${refresh1.status}: ${refresh1.data.error || ''}`);

  if (refresh1.status === 200) {
    const newAccessToken = refresh1.data.accessToken;
    const newRefreshToken = refresh1.data.refreshToken;
    assert('Refresh returns new accessToken', !!newAccessToken);
    assert('Refresh returns new refreshToken', !!newRefreshToken);
    assert('New accessToken differs from old', newAccessToken !== accessToken);

    // 5. Old refresh token SHOULD be revoked (refresh rotation)
    const refresh2 = await api('POST', '/api/auth/refresh', null, { refreshToken });
    assert('Old refreshToken reused → 401', refresh2.status === 401 || refresh2.status === 400,
      `got ${refresh2.status} (should reject revoked token)`);

    // 6. New access token should work
    const me2 = await api('GET', '/api/auth/me', newAccessToken, null);
    assert('New accessToken works', me2.status === 200,
      `got ${me2.status}`);

    // 7. Logout
    const logout = await api('POST', '/api/auth/logout', null, { refreshToken: newRefreshToken });
    assert('Logout → 200', logout.status === 200,
      `got ${logout.status}`);

    // 8. Refresh after logout → should fail
    const refresh3 = await api('POST', '/api/auth/refresh', null, { refreshToken: newRefreshToken });
    assert('Refresh after logout → 401', refresh3.status === 401,
      `got ${refresh3.status}`);
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test harness error:', e.message);
  process.exit(1);
});
