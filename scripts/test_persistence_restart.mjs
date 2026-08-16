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
//   5. Concurrent writers serialize via the advisory write lock: two children
//      hammering saveEmployees() on the same data dir leave a final file that is
//      valid JSON equal to ONE complete writer payload (no torn/interleaved state).
//   6. Atomic rename in use: no lingering `.tmp-*` files after writes, and the
//      `.lock` directory is released (no stale lock).
//
// Persistence gap verified-and-documented (NOT fabricated away):
//   - The access model is JSON-file authoritative; Neon covers only the RAG
//     registry (server/neonStore.js). The advisory lock is filesystem-local: it
//     serializes writers that share a data dir, but NOT separate hosts.
//   - Full Neon write-through for the access model is DEFERRED — production
//     readiness for multi-instance (cross-host) access persistence is BLOCKED.
//
// Usage: node scripts/test_persistence_restart.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

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

// ── Phase 3: concurrent writers serialize via the advisory write lock ─────────
// Two child processes hammer saveEmployees() on the SAME data dir at the same
// time. Each save is a complete-file replacement performed under the advisory
// lock + atomic rename, so the final file must be valid JSON equal to exactly
// ONE writer's complete payload — never a torn/interleaved mix. After the dust
// settles there must be no lingering .tmp-* files and no leftover .lock dir.
console.log('\n── Concurrent writers serialize via advisory lock ──');

function runChildAsync(code) {
  return new Promise((resolve) => {
    const child = spawn('node', ['--input-type=module', '-e', code], {
      cwd: ROOT,
      env: { ...process.env, PERSIST_TMP: TMP },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const WRITERS = ['A', 'B'];
const WRITES_PER_WRITER = 25;
const writerCode = (who, n) => `
import fs from 'fs';
process.env.ACCESS_DATA_DIR = process.env.PERSIST_TMP;
const store = await import('${ROOT}/server/access/accessStore.js');
for (let i = 0; i < ${n}; i++) {
  store.saveEmployees([{ employeeCode: 'EMP-W-${who}', who: '${who}', seq: i, accessProfile: 'SELF_ONLY', status: 'active' }]);
}
`;
const writerRuns = await Promise.all(
  WRITERS.map((w) => runChildAsync(writerCode(w, WRITES_PER_WRITER)))
);

assert('concurrent writers all exited cleanly',
  writerRuns.every((r) => r.code === 0),
  writerRuns.map((r) => `code=${r.code} stderr=${(r.stderr || '').slice(0, 120)}`).join(' '));

let finalEmployees = null;
try {
  finalEmployees = JSON.parse(fs.readFileSync(path.join(TMP, 'employees.json'), 'utf-8'));
} catch (e) { /* reported by the next assertion */ }
assert('final employees.json is valid JSON (no torn state)',
  Array.isArray(finalEmployees), `parse error: ${String(finalEmployees)}`);
assert('final file equals ONE complete writer payload (serialized, not interleaved)',
  Array.isArray(finalEmployees) && finalEmployees.length === 1
    && WRITERS.includes(finalEmployees[0]?.who)
    && typeof finalEmployees[0]?.seq === 'number'
    && finalEmployees[0].seq >= 0 && finalEmployees[0].seq < WRITES_PER_WRITER,
  `length=${Array.isArray(finalEmployees) ? finalEmployees.length : '?'} who=${finalEmployees?.[0]?.who} seq=${finalEmployees?.[0]?.seq}`);

const leftoverTmp = fs.readdirSync(TMP).filter((f) => /\.tmp-\d+$/.test(f));
assert('atomic rename in use — no lingering .tmp files after writes', leftoverTmp.length === 0, leftoverTmp.join(', '));
assert('advisory lock released — no .lock directory remains', !fs.existsSync(path.join(TMP, '.lock')));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);

