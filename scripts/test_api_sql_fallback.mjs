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

  // 5. Validate the SQL lifecycle from authoritative response metadata.
  const traceNodes = (data.trace || []).map(t => `${t.node}:${t.note}`);
  console.log(`     Trace: ${traceNodes.join(' | ')}`);

  assert('SQL metadata fields are present',
    typeof data.sqlDetected === 'boolean' &&
    typeof data.sqlAttempted === 'boolean' &&
    typeof data.sqlSucceeded === 'boolean' &&
    (data.fallbackRoute === null || typeof data.fallbackRoute === 'string'),
    `sqlDetected=${data.sqlDetected} sqlAttempted=${data.sqlAttempted} ` +
    `sqlSucceeded=${data.sqlSucceeded} fallbackRoute=${data.fallbackRoute}`);

  if (data.cached) {
    assert('Cache hit → valid cache metadata',
      data.route === 'cache' && data.answerSource === 'cache' && data.fallbackRoute === null,
      `route=${data.route} answerSource=${data.answerSource}`);
  } else if (data.sqlAttempted && data.sqlSucceeded) {
    // SQL can succeed with zero rows; that is not a failure fallback.
    assert('SQL success → no fallback route', data.route === 'sql' && data.fallbackRoute === null,
      `route=${data.route} fallbackRoute=${data.fallbackRoute}`);
    assert('SQL success → SQL answer source', data.answerSource === 'sql-analytics',
      `answerSource=${data.answerSource}`);
    assert('SQL evidence reports zero rows when result is empty',
      data.sqlEvidence && data.sqlEvidence.status !== 'unavailable' && data.sqlEvidence.rowCount === 0,
      `sqlEvidence=${JSON.stringify(data.sqlEvidence)}`);
  } else if (data.sqlAttempted) {
    // SQL error/blocked generation must fall back to a non-SQL answer route.
    assert('SQL failure → meaningful fallback route',
      ['keyword', 'vector', 'template'].includes(data.route) &&
      data.route === data.fallbackRoute &&
      data.answerSource !== 'sql-analytics',
      `route=${data.route} fallbackRoute=${data.fallbackRoute} answerSource=${data.answerSource}`);
  } else {
    assert('SQL not attempted → direct keyword/vector route',
      ['keyword', 'vector', 'template'].includes(data.route) && data.fallbackRoute === null,
      `route=${data.route} fallbackRoute=${data.fallbackRoute}`);
  }

  // 6. answerSource should be a meaningful pipeline source (LLM is no longer
  // hardcoded to 'gemini'; it is 'llm' with provider/model returned separately).
  assert('answerSource is valid',
    ['template', 'llm', 'sql-analytics', 'cache'].includes(data.answerSource),
    `answerSource=${data.answerSource}`);

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped / ${tests.length} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test harness error:', e.message);
  process.exit(1);
});
