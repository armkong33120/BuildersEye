// test_persistence_restart.mjs — Restart/persistence regression for the access
// model store (Phase 5). Proves that file-backed access state survives a full
// process restart and that in-memory caches reset (as designed), by spawning a
// child node process that re-loads the store against the SAME ACCESS_DATA_DIR.
//
// Persistence facts verified:
//   1. profiles/policies/employees/relationships/source_links survive restart.
//   2. policy_version survives restart (cache-invalidation baseline is durable).
//   3. audit.jsonl survives restart.
//   4. responseCache is process-local → empty after restart (expected, bounded
//      memory by design; permission changes invalidate via policy_version).
//
// Persistence gap verified-and-documented (NOT fabricated away):
//   - The access model is JSON-file authoritative; Neon covers only the RAG
//     registry (server/neonStore.js). Multi-instance writes are not locked.
//   - Full Neon write-through for the access model is DEFERRED — production
//     readiness for multi-instance access persistence is BLOCKED.
//
// Usage: node scripts/test_persistence_restart.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-persist-'));
process.env.ACCESS_DATA_DIR = TMP;

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

const ROOT = path.resolve(__dirname, '..');

// ── Phase 1: seed durable state in THIS process ───────────────────────────────
const { SEED_PROFILES, SEED_POLICIES } = await import('../server/access/accessModel.js');
const store = await import('../server/access/accessStore.js');
const audit = await import('../server/access/auditStore.js');

store.saveProfiles(SEED_PROFILES);
store.savePolicies(SEED_POLICIES);
store.saveEmployees([
  { employeeCode: 'EMP001', code: 'EMP001', accessProfile: 'GLOBAL_ADMIN', managerCode: null, status: 'active' },
  { employeeCode: 'EMP002', code: 'EMP002', accessProfile: 'TEAM_MANAGER', managerCode: 'EMP001', status: 'active' },
  { employeeCode: 'EMP003', code: 'EMP003', accessProfile: 'SELF_ONLY', managerCode: 'EMP002', status: 'active' },
]);
store.saveRelationships([
  { employeeCode: 'EMP002', managerCode: 'EMP001', relationshipType: 'reports', effectiveFrom: '2026-01-01', effectiveTo: null },
]);
store.saveSourceLinks([{ sourceId: 'src_keep', employeeCode: 'EMP001', enabled: true }]);
store.bumpPolicyVersion(); // 1 → 2
store.bumpPolicyVersion(); // 2 → 3
audit.recordAudit({ username: 'ceo' }, { entity: 'profile', action: 'update', entityId: 'GLOBAL_ADMIN' }, { previous: null, next: {} });
const expected = {
  profiles: store.getProfiles().length,
  policies: store.getPolicies().length,
  employees: store.getEmployees().length,
  relationships: store.getRelationships().length,
  sourceLinks: store.getSourceLinks().length,
  policyVersion: store.getPolicyVersion(),
  auditLines: audit.listAudit({ limit: 100 }).length,
};
console.log('  seeded: ' + JSON.stringify(expected));

// ── Phase 2: "restart" — fresh process, same ACCESS_DATA_DIR ─────────────────
const childCode = `
import fs from 'fs';
process.env.ACCESS_DATA_DIR = process.env.PERSIST_TMP;
const store = await import('${ROOT}/server/access/accessStore.js');
const audit = await import('${ROOT}/server/access/auditStore.js');
const out = {
  profiles: store.getProfiles().length,
  policies: store.getPolicies().length,
  employees: store.getEmployees().length,
  relationships: store.getRelationships().length,
  sourceLinks: store.getSourceLinks().length,
  policyVersion: store.getPolicyVersion(),
  auditLines: audit.listAudit({ limit: 100 }).length,
  cacheSize: (await import('${ROOT}/server/responseCache.js')).cacheStats().size,
};
process.stdout.write(JSON.stringify(out));
`;
const child = spawnSync('node', ['--input-type=module', '-e', childCode], {
  cwd: ROOT,
  env: { ...process.env, PERSIST_TMP: TMP },
  encoding: 'utf-8',
  timeout: 30_000,
});

console.log('\n── Restart persistence ──');
if (child.status !== 0) {
  assert('restart child process exited cleanly', false, `status=${child.status} stderr=${child.stderr?.slice(0, 300)}`);
} else {
  assert('restart child process exited cleanly', true);
  let got = {};
  try { got = JSON.parse(child.stdout); } catch (e) { assert('child output is valid JSON', false, child.stdout?.slice(0, 200)); }
  assert('profiles survive restart', got.profiles === expected.profiles, `${got.profiles} vs ${expected.profiles}`);
  assert('policies survive restart', got.policies === expected.policies, `${got.policies} vs ${expected.policies}`);
  assert('employees survive restart', got.employees === expected.employees, `${got.employees} vs ${expected.employees}`);
  assert('relationships survive restart', got.relationships === expected.relationships, `${got.relationships} vs ${expected.relationships}`);
  assert('source links survive restart', got.sourceLinks === expected.sourceLinks, `${got.sourceLinks} vs ${expected.sourceLinks}`);
  assert('policy version survives restart (cache baseline durable)', got.policyVersion === expected.policyVersion, `${got.policyVersion} vs ${expected.policyVersion}`);
  assert('audit log survives restart', got.auditLines === expected.auditLines, `${got.auditLines} vs ${expected.auditLines}`);
  assert('response cache is process-local (empty after restart — by design)',
    got.cacheSize === 0, `cacheSize=${got.cacheSize}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);

