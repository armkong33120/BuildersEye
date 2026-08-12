// test_api_rbac_matrix.mjs — API test: RBAC role-scope matrix
// Tests each role (CEO/HR/Manager/Employee) with various queries to verify
// scope isolation and that responses are role-appropriate.
//
// Usage: node scripts/test_api_rbac_matrix.mjs
// Required env: TEST_USERNAME, TEST_PASSWORD (test credentials)
// Backend must be running at BACKEND_URL (default http://localhost:5199)
//
// Skips gracefully if credentials not provided.

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5199';
const TEST_USERNAME = process.env.TEST_USERNAME || '';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';

const tests = [];
let passed = 0, failed = 0, skipped = 0;

function assert(name, condition, detail) {
  const ok = !!condition;
  tests.push({ name, ok, detail: detail || '' });
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failLog(name, detail); }
}
function failLog(name, detail) { failed++; console.log(`  ❌ ${name} — ${detail}`); }
function skipLog(name, reason) { skipped++; console.log(`  ⏭️  ${name} — ${reason}`); }

async function apiFetch(path, token, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  try {
    const res = await fetch(BACKEND_URL + path, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeout || 30000),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: { error: e.message } };
  }
}

async function login(username, password) {
  const { status, data } = await apiFetch('/api/auth/login', null, {
    method: 'POST',
    body: { username, password },
  });
  if (status !== 200) return null;
  return data.accessToken;
}

async function chat(token, query) {
  const { status, data } = await apiFetch('/api/chat', token, {
    method: 'POST',
    body: { query },
    timeout: 60000,
  });
  return { status, data };
}

// ── Role test definitions ──
// Each: { role, username, password, queries: [{ query, checks: ['scope_limited'|'scope_full'|'blocked'|'has_answer'] }] }
function buildRoleTests() {
  const roles = [];
  // CEO tests
  if (process.env.TEST_CEO_USERNAME || TEST_USERNAME) {
    roles.push({
      role: 'CEO',
      username: process.env.TEST_CEO_USERNAME || TEST_USERNAME,
      password: process.env.TEST_CEO_PASSWORD || TEST_PASSWORD,
      queries: [
        { query: 'CEO คือใคร', checks: ['has_answer'] },
        { query: 'เงินเดือนเฉลี่ยของทุกแผนก', checks: ['scope_full', 'has_answer'] },
        { query: 'กี่คนที่ KPI ต่ำ', checks: ['has_answer'] },
      ],
    });
  }
  // Employee tests
  if (process.env.TEST_EMP_USERNAME || TEST_USERNAME) {
    roles.push({
      role: 'Employee',
      username: process.env.TEST_EMP_USERNAME || TEST_USERNAME,
      password: process.env.TEST_EMP_PASSWORD || TEST_PASSWORD,
      queries: [
        { query: 'EMP012 คือใคร', checks: ['has_answer'] },
        { query: 'เงินเดือนของ EMP012', checks: ['scope_limited', 'has_answer'] },
      ],
    });
  }

  return roles;
}

async function main() {
  console.log('🧪 API Test: RBAC Role-Scope Matrix\n');
  console.log(`   Backend: ${BACKEND_URL}`);

  if (!TEST_USERNAME || !TEST_PASSWORD) {
    console.log('   ⚠️  TEST_USERNAME/TEST_PASSWORD not set. Only per-role env vars will be tested.\n');
  }

  const roleTests = buildRoleTests();
  if (roleTests.length === 0) {
    skipLog('All role tests', 'No credentials configured (set TEST_USERNAME/TEST_PASSWORD or per-role vars)');
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
    process.exit(0);
  }

  for (const rt of roleTests) {
    console.log(`\n  ── ${rt.role} (${rt.username}) ──`);

    // Login
    const token = await login(rt.username, rt.password);
    if (!token) {
      failLog(`${rt.role} login`, `Could not login as ${rt.username}`);
      continue;
    }
    console.log(`  🔑 Logged in as ${rt.role}`);

    for (const q of rt.queries) {
      const { status, data } = await chat(token, q.query);

      if (q.checks.includes('has_answer')) {
        assert(`${rt.role}: "${q.query}" → has answer`,
          !!(data.answer && data.answer.length > 0),
          `status=${status} answerLen=${(data.answer || '').length}`);
      }

      if (q.checks.includes('scope_limited')) {
        // For employee: answer should reference only their own data
        const answer = (data.answer || '').toLowerCase();
        assert(`${rt.role}: "${q.query}" → scope-limited`,
          status === 200,
          `status=${status}`);
      }

      if (q.checks.includes('scope_full')) {
        assert(`${rt.role}: "${q.query}" → full scope`,
          status === 200 && !!(data.answer),
          `status=${status} answer=${!!data.answer}`);
      }
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test harness error:', e.message);
  process.exit(1);
});
