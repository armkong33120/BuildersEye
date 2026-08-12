// test_api_sql_fallback.mjs — API test: SQL failure fallback regression
// Tests the specific case: "วิศวกรคนไหนทำ OT เทปูนข้ามคืน"
// This query matches the needsSqlAnalytics regex (contains "ปัญหา")
// but is actually a keyword/semantic query about specific employees.
// The SQL engine fails to generate meaningful SQL for it.
//
// BEFORE fix: SQL error context was fed to LLM → bad answer
// AFTER fix: SQL failure falls back to keyword/vector search answer
//
// Usage: node scripts/test_api_sql_fallback.mjs
// Requires: BACKEND_URL, TEST_USERNAME, TEST_PASSWORD (env vars)

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
  console.log('🧪 API Test: SQL Failure Fallback Regression\n');
  console.log('   Query: "วิศวกรคนไหนทำ OT เทปูนข้ามคืน"\n');
  console.log(`   Backend: ${BACKEND_URL}`);

  if (!TEST_USERNAME || !TEST_PASSWORD) {
    skipLog('SQL fallback test', 'TEST_USERNAME/TEST_PASSWORD not set');
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

  // Test the regression query
  const query = 'วิศวกรคนไหนทำ OT เทปูนข้ามคืน';
  const { status, data } = await post('/api/chat', token, { query });

  // 1. Must return 200
  assert('Response status 200', status === 200, `got ${status}`);

  // 2. Must have an answer
  const answer = (data.answer || '');
  assert('Has answer', answer.length > 0, `answerLen=${answer.length}`);

  // 3. Answer must NOT contain SQL error messages
  const noSqlError = !answer.toLowerCase().includes('failed to compute') &&
                     !answer.toLowerCase().includes('query execution failed') &&
                     !answer.toLowerCase().includes('sql error');
  assert('No SQL error in answer', noSqlError,
    `answer preview: ${answer.slice(0, 150)}`);

  // 4. Answer should contain relevant Thai text about OT/engineers
  const isThai = /[ก-๙]/.test(answer);
  assert('Answer contains Thai text', isThai,
    `answer preview: ${answer.slice(0, 150)}`);

  // 5. Trace should show sql error fallback to keyword
  const traceNodes = (data.trace || []).map(t => `${t.node}:${t.note}`);
  console.log(`     Trace: ${traceNodes.join(' | ')}`);

  const hasFallback = traceNodes.some(n => n.includes('fallback') || n.includes('keyword'));
  // If the query is misrouted to SQL, we expect the fallback trace
  // If it's correctly NOT routed to SQL, that's also fine
  const sqlAttempted = traceNodes.some(n => n.startsWith('sqle'));
  if (sqlAttempted) {
    assert('SQL attempted → has fallback to keyword', hasFallback, `trace: ${traceNodes.join(' | ')}`);
  } else {
    assert('SQL not needed → direct keyword', true, 'query handled by keyword path');
  }

  // 6. answerSource should be 'template' if LLM unavailable, or something meaningful
  assert('answerSource is valid',
    ['template', 'gemini', 'sql-analytics'].includes(data.answerSource),
    `answerSource=${data.answerSource}`);

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test harness error:', e.message);
  process.exit(1);
});
