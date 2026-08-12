// test_api_invalid_login.mjs — API test: invalid login credentials
// Tests:
//   1. Login with wrong password → 401
//   2. Login with wrong username → 401
//   3. Login with empty password → 400
//   4. Login with null body → 400
//
// Usage: node scripts/test_api_invalid_login.mjs
// Requires backend running at BACKEND_URL (default http://localhost:5199)

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5199';

const tests = [];
let passed = 0, failed = 0;

function assert(name, condition, detail) {
  const ok = !!condition;
  tests.push({ name, ok, detail: detail || '' });
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}

async function post(path, body) {
  try {
    const res = await fetch(BACKEND_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, body: { error: e.message } };
  }
}

async function main() {
  console.log('🧪 API Test: Invalid Login\n');
  console.log(`   Backend: ${BACKEND_URL}`);

  // 1. Wrong password
  const r1 = await post('/api/auth/login', { username: 'ceo', password: 'WrongPassword123!' });
  assert('Wrong password → 401', r1.status === 401, `got ${r1.status}: ${r1.body?.error}`);

  // 2. Wrong username
  const r2 = await post('/api/auth/login', { username: 'nonexistent_user_999', password: 'anything123' });
  assert('Wrong username → 401', r2.status === 401, `got ${r2.status}: ${r2.body?.error}`);

  // 3. Empty password
  const r3 = await post('/api/auth/login', { username: 'ceo', password: '' });
  assert('Empty password → 400', r3.status === 400, `got ${r3.status}: ${r3.body?.error}`);

  // 4. Missing fields
  const r4 = await post('/api/auth/login', {});
  assert('Empty body → 400', r4.status === 400, `got ${r4.status}: ${r4.body?.error}`);

  // 5. SQL injection in username (safety check — should still return 401)
  const r5 = await post('/api/auth/login', { username: "' OR 1=1--", password: 'test' });
  assert('SQL injection username → 401', r5.status === 401, `got ${r5.status}`);

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test harness error:', e.message);
  process.exit(1);
});
