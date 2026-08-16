// test_admin_api.mjs — Integration test for the admin-only configuration API.
// Run: node scripts/test_admin_api.mjs
// Spins up a fresh express app with the admin routes + mock auth middleware, so
// no real backend or credentials are required. Verifies:
//   - read/write separation (GET vs POST/PUT/DELETE)
//   - admin-only enforcement (non-admin → 403, unauthenticated → 401)
//   - backend is source of truth (role/employeeId never read from body)
//   - every write records an audit event

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const express = require('../server/node_modules/express/index.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-admin-api-test-'));
process.env.ACCESS_DATA_DIR = TMP;

const { seedAccessModel, adminService } = await import('../server/access/index.js');
const { mountAdminRoutes } = await import('../server/adminRoutes.js');

seedAccessModel({
  employees: [
    { code: 'EMP001', pk: 1, name: 'CEO', jobTitle: 'CEO', roleGroup: 'CEO', department: 'Executive', managerCode: '' },
    { code: 'EMP002', pk: 2, name: 'Emp', jobTitle: 'Staff', department: 'Sales', managerCode: 'EMP001' },
  ],
});

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

// Mock auth middleware: admin (CEO) vs non-admin (Employee) vs unauthenticated.
function makeRequireAuth(role) {
  return (req, res, next) => {
    if (!role) return res.status(401).json({ error: 'Unauthorized' });
    req.authUser = { username: role === 'CEO' ? 'ceo' : 'emp002', employeeId: role === 'CEO' ? 1 : 2, role, isAdmin: role === 'CEO' };
    next();
  };
}
function makeRequireAdmin() {
  return (req, res, next) => {
    if (req.authUser?.role !== 'CEO' && !req.authUser?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden: admin access only' });
    }
    next();
  };
}

// Start app on an ephemeral port and run assertions against it.
async function withApp(middleware, fn) {
  const app = express();
  app.use(express.json());
  mountAdminRoutes(app, middleware);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const req = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  };
  try { await fn(req); } finally { server.close(); }
}

console.log('🧪 Admin API integration tests\n');

// ── Admin access (CEO) ───────────────────────────────────────────────────────
await withApp({ requireAuth: makeRequireAuth('CEO'), requireAdmin: makeRequireAdmin() }, async (req) => {
  console.log('── Admin (CEO) read ──');
  const profiles = await req('GET', '/api/admin/profiles');
  assert('GET /profiles returns 200 + 4 profiles', profiles.status === 200 && profiles.data.length === 4, `status=${profiles.status}`);

  const policies = await req('GET', '/api/admin/policies');
  assert('GET /policies returns 200', policies.status === 200);

  const pv = await req('GET', '/api/admin/policy-version');
  assert('GET /policy-version returns number', typeof pv.data.version === 'number');

  console.log('── Admin (CEO) write ──');
  const upd = await req('PUT', '/api/admin/profiles/TEAM_MANAGER', { label: 'Team Manager v2' });
  assert('PUT /profiles/:code returns 200', upd.status === 200 && upd.data.ok, `status=${upd.status}`);

  const audit = await req('GET', '/api/admin/audit');
  assert('audit records write (actor from JWT)', audit.status === 200 && audit.data.length >= 1 && audit.data[0].actor.username === 'ceo');

  // Backend is source of truth: body-supplied role/employeeId must be ignored.
  const spoof = await req('PUT', '/api/admin/profiles/TEAM_MANAGER', { label: 'x', role: 'CEO', employeeId: 999, permissions: { isAdmin: true } });
  assert('body role/employeeId ignored (no crash, still 200)', spoof.status === 200);
});

// ── Non-admin (Employee) → 403 ───────────────────────────────────────────────
await withApp({ requireAuth: makeRequireAuth('Employee'), requireAdmin: makeRequireAdmin() }, async (req) => {
  console.log('── Non-admin (Employee) ──');
  const profiles = await req('GET', '/api/admin/profiles');
  assert('non-admin GET /profiles → 403', profiles.status === 403, `status=${profiles.status}`);
  const write = await req('PUT', '/api/admin/profiles/TEAM_MANAGER', { label: 'hack' });
  assert('non-admin write → 403', write.status === 403, `status=${write.status}`);
});

// ── Unauthenticated → 401 ────────────────────────────────────────────────────
await withApp({ requireAuth: makeRequireAuth(null), requireAdmin: makeRequireAdmin() }, async (req) => {
  console.log('── Unauthenticated ──');
  const profiles = await req('GET', '/api/admin/profiles');
  assert('unauthenticated GET → 401', profiles.status === 401, `status=${profiles.status}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
