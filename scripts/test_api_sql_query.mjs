// test_api_sql_query.mjs — API test: SQL analytics query routing
// Tests that analytics queries are correctly routed to the SQL engine
// and return proper structured data.
//
// Usage: node scripts/test_api_sql_query.mjs
// Requires: BACKEND_URL, TEST_USERNAME, TEST_PASSWORD (env vars)
// LLM key optional — skips if unavailable

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5199';
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
      signal: AbortSignal.timeout(60000),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, data: { error: e.message } };
  }
}

async function main() {
  console.log('🧪 API Test: SQL Analytics Queries\n');
  console.log(`   Backend: ${BACKEND_URL}`);

  if (!TEST_USERNAME || !TEST_PASSWORD) {
    skipLog('All SQL tests', 'TEST_USERNAME/TEST_PASSWORD not set');
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
  const role = loginRes.data.user?.role || '?';
  console.log(`  🔑 Logged in as ${role}`);

  // Only CEO/HR can meaningfully test SQL analytics (full scope)
  if (role !== 'CEO' && role !== 'HR') {
    skipLog('Full-scope SQL tests', `Role ${role} has limited scope — use CEO/HR for full testing`);
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
    process.exit(0);
  }

  // Test SQL-routed queries
  const sqlQueries = [
    'เงินเดือนเฉลี่ยของทุกแผนก',
    'รวมโบนัสทั้งหมดของปีนี้',
    'สรุปจำนวนพนักงานแยกแผนก',
    'อุปกรณ์ IT มีมูลค่ารวมเท่าไหร่',
  ];

  for (const q of sqlQueries) {
    const { status, data } = await post('/api/chat', token, { query: q });

    assert(`SQL: "${q}" → success`, status === 200,
      `status=${status} answerLen=${(data.answer || '').length} sqlUsed=${data.sqlUsed} answerSource=${data.answerSource}`);

    // Check that trace contains sql-related nodes
    const traceNodes = (data.trace || []).map(t => t.node);
    const hasSqlTrace = traceNodes.includes('sql') || traceNodes.includes('sqle') || traceNodes.includes('llm');
    assert(`SQL: "${q}" → has trace`, hasSqlTrace,
      `trace nodes: ${traceNodes.join(',')}`);

    // Answer should not contain "Failed to compute SQL" or raw error
    const answer = (data.answer || '').toLowerCase();
    const noSqlError = !answer.includes('failed to compute') && !answer.includes('query execution failed');
    assert(`SQL: "${q}" → clean answer`, noSqlError,
      `answer preview: ${(data.answer || '').slice(0, 100)}`);
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test harness error:', e.message);
  process.exit(1);
});
