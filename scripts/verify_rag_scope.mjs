// verify_rag_scope.mjs — Live verification of the canonical scope wiring against
// a running backend. Logs in as CEO (ALL) and an employee (SELF) and checks that
// the registry scope + vector staleness flag behave as expected.
// Run: node scripts/verify_rag_scope.mjs  (backend must be running)

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5199';

async function post(path, token, body) {
  const res = await fetch(BACKEND_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function get(path, token) {
  const res = await fetch(BACKEND_URL + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

console.log('🧪 RAG scope wiring verification (live)\n');

// CEO login
const ceoLogin = await post('/api/auth/login', null, { username: 'ceo', password: process.env.TEST_ACCOUNT_PASSWORD || '' });
if (ceoLogin.status !== 200) {
  console.log('  ⚠️  CEO login failed — set TEST_ACCOUNT_PASSWORD (or run with backend .env loaded).');
  process.exit(2);
}
const ceoToken = ceoLogin.data.accessToken;

// CEO registry status → vectors.stale should be present
const status = await get('/api/registry/status', ceoToken);
assert('registry/status exposes vectors.stale (boolean)', typeof status.data.vectors?.stale === 'boolean',
  JSON.stringify(status.data.vectors));

// CEO sees all active employees
const ceoEmps = await get('/api/registry/employees', ceoToken);
assert('CEO sees all active employees', ceoEmps.data.count === status.data.activeEmployees,
  `count=${ceoEmps.data.count} active=${status.data.activeEmployees}`);

// Employee (SELF_ONLY) login — 'emp012' is a seeded Employee (employeeId 12).
const empLogin = await post('/api/auth/login', null, { username: 'emp012', password: process.env.TEST_ACCOUNT_PASSWORD || '' });
if (empLogin.status === 200) {
  const empToken = empLogin.data.accessToken;
  const empEmps = await get('/api/registry/employees', empToken);
  // SELF_ONLY should see exactly 1 employee (self), never the full org.
  assert('Employee sees only self (scope=1)', empEmps.data.count === 1,
    `count=${empEmps.data.count}`);
} else {
  console.log('  ⚠️  emp012 login failed — skipping employee scope check.');
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
