// test_org_integrity.mjs — Write-path org integrity tests (Part A / M2).
// Run: node scripts/test_org_integrity.mjs
// Uses a temp ACCESS_DATA_DIR so it never touches real runtime data.
//
// Covers:
//   1. seedAccessModel stays idempotent and NEVER rejects duplicates from seeding
//   2. duplicate employeeCode — unit (create) + store (update) → 409 + audit
//   3. direct self-manager A→A → 400 (unit + adminService)
//   4. indirect cycles A→B→A (adminService) and A→B→C→A (unit) → 409
//   5. missing manager (non-null, unresolvable) → 400 + audit
//   6. valid single root / valid multi-root preserved
//   7. moving an employee to a valid manager succeeds
//   8. invalid change does NOT partially write (store byte-identical after rejection)
//   9. rejected writes are audited with action:'rejected' + safe detail
//  10. buildOrgSnapshot stays crash-safe on legacy bad data (duplicates/cycles)

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-org-integrity-'));
process.env.ACCESS_DATA_DIR = TMP;

const {
  seedAccessModel,
  getEmployees, saveEmployees, getRelationships, getPolicyVersion,
  listAudit,
  adminService,
  assertNoDuplicateEmployeeCodes,
  assertAcyclicManagerGraph,
  assertManagerExists,
  assertOrgIntegrity,
  buildOrgSnapshot,
  ACCESS_PROFILE_CODES,
} = await import('../server/access/index.js');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

const admin = { username: 'ceo', employeeId: 1, role: 'CEO' };

const ORG = [
  { code: 'EMP001', pk: 1, name: 'CEO', jobTitle: 'CEO', roleGroup: 'CEO', department: 'Executive', managerCode: '' },
  { code: 'EMP002', pk: 2, name: 'Mgr', jobTitle: 'Manager', department: 'Sales', managerCode: 'EMP001' },
  { code: 'EMP003', pk: 3, name: 'Staff A', jobTitle: 'Staff', department: 'Sales', managerCode: 'EMP002' },
  { code: 'EMP004', pk: 4, name: 'Staff B', jobTitle: 'Staff', department: 'Sales', managerCode: 'EMP002' },
];

const storeState = () => JSON.stringify({ employees: getEmployees(), relationships: getRelationships() });
const lastRejected = (entity) => listAudit({ limit: 50, entity }).find((e) => e.change?.action === 'rejected');

console.log('🧪 Org integrity tests\n');

// ── 1. Seed idempotence + legacy-bad-data safety ─────────────────────────────
console.log('── 1. Seed idempotence + buildOrgSnapshot crash-safety ──');
let seedErr = null;
try { seedAccessModel({ employees: ORG }); } catch (e) { seedErr = e; }
try { seedAccessModel({ employees: ORG }); } catch (e) { seedErr = seedErr || e; }
assert('seedAccessModel seeded twice without throwing (idempotent)', !seedErr, seedErr?.message);
assert('seeded 4 employees', getEmployees().length === 4, `got ${getEmployees().length}`);
assert('seeded profiles intact after re-seed', adminService.readAccess.profiles().length === 4);

// seedAccessModel must NOT reject duplicate codes that come from legacy data:
let dupSeedErr = null;
try { seedAccessModel({ employees: [{ code: 'EMP900', jobTitle: 'Staff', managerCode: '' }, { code: 'EMP900', jobTitle: 'Staff', managerCode: '' }] }); } catch (e) { dupSeedErr = e; }
assert('seedAccessModel does NOT reject duplicate codes from seeding (idempotent)', !dupSeedErr, dupSeedErr?.message);

// buildOrgSnapshot must not crash on legacy bad data (duplicates + cycles):
let snapCrash = null;
try {
  buildOrgSnapshot([
    { code: 'EMP900', managerCode: 'EMP900' }, // self-cycle
    { code: 'EMP900', managerCode: 'EMP901' }, // duplicate code
    { code: 'EMP901', managerCode: 'EMP900' }, // mutual cycle
  ]);
} catch (e) { snapCrash = e; }
assert('buildOrgSnapshot survives duplicate + cyclic legacy data (no crash)', !snapCrash, snapCrash?.message);

// ── 2. Duplicate employee codes ──────────────────────────────────────────────

// Store already containing duplicates (legacy bad data) → admin write rejected,
// no partial write, audited:
saveEmployees([
  { employeeCode: 'EMP001', managerCode: '', accessProfile: ACCESS_PROFILE_CODES.GLOBAL_ADMIN, version: 1 },
  { employeeCode: 'EMP001', managerCode: '', accessProfile: ACCESS_PROFILE_CODES.SELF_ONLY, version: 1 },
  { employeeCode: 'EMP002', managerCode: 'EMP001', accessProfile: ACCESS_PROFILE_CODES.TEAM_MANAGER, version: 1 },
]);
const dupBefore = storeState();
let dupStore = null;
try { await adminService.assignProfile(admin, 'EMP002', ACCESS_PROFILE_CODES.SELF_ONLY); } catch (e) { dupStore = e; }
assert('admin write on duplicate-laden store rejected (409)', dupStore && dupStore.status === 409, dupStore?.message);
assert('duplicate rejection left store untouched (no partial write)', storeState() === dupBefore);
const dupAudit = lastRejected('employee');
assert('duplicate rejection audited with safe detail', dupAudit && dupAudit.change?.action === 'rejected' && dupAudit.change?.detail === 'duplicate employeeCode',
  JSON.stringify(dupAudit?.change));

// ── 3-4. Cycles (self / indirect) ────────────────────────────────────────────
console.log('── 3-4. Hierarchy cycles ──');
let selfMgrUnit = null;
try { assertAcyclicManagerGraph([{ code: 'A', managerCode: 'A' }]); } catch (e) { selfMgrUnit = e; }
assert('unit: direct self-manager A→A rejected (400)', selfMgrUnit && selfMgrUnit.status === 400, selfMgrUnit?.message);

let cyc2 = null;
try { assertAcyclicManagerGraph([{ code: 'A', managerCode: 'B' }, { code: 'B', managerCode: 'A' }]); } catch (e) { cyc2 = e; }
assert('unit: indirect cycle A→B→A rejected (409)', cyc2 && cyc2.status === 409, cyc2?.message);

let cyc3 = null;
try { assertAcyclicManagerGraph([{ code: 'A', managerCode: 'B' }, { code: 'B', managerCode: 'C' }, { code: 'C', managerCode: 'A' }]); } catch (e) { cyc3 = e; }
assert('unit: indirect cycle A→B→C→A rejected (409)', cyc3 && cyc3.status === 409, cyc3?.message);

// ── 5-7. adminService setManager validation (no partial writes) ───────────────
console.log('── 5-7. adminService setManager validation (no partial writes) ──');
// Rebuild a clean org for the service-level tests:
saveEmployees([
  { employeeCode: 'EMP001', managerCode: '', accessProfile: ACCESS_PROFILE_CODES.GLOBAL_ADMIN, version: 1 },
  { employeeCode: 'EMP002', managerCode: 'EMP001', accessProfile: ACCESS_PROFILE_CODES.TEAM_MANAGER, version: 1 },
  { employeeCode: 'EMP003', managerCode: 'EMP002', accessProfile: ACCESS_PROFILE_CODES.SELF_ONLY, version: 1 },
  { employeeCode: 'EMP004', managerCode: 'EMP002', accessProfile: ACCESS_PROFILE_CODES.SELF_ONLY, version: 1 },
]);

let missingMgr = null;
const mmBefore = storeState();
try { await adminService.setManager(admin, 'EMP003', 'NOPE'); } catch (e) { missingMgr = e; }
assert('missing manager (non-null, unresolvable) rejected (400)', missingMgr && missingMgr.status === 400, missingMgr?.message);
assert('missing-manager rejection left store untouched', storeState() === mmBefore);
const mmAudit = lastRejected('relationship');
assert('missing-manager rejection audited with safe detail', mmAudit && mmAudit.change?.action === 'rejected' && mmAudit.change?.detail === 'missing manager',
  JSON.stringify(mmAudit?.change));

console.log('── 2. Duplicate employee codes ──');
let dupCreate = null;
try { assertNoDuplicateEmployeeCodes([{ employeeCode: 'EMP001' }, { employeeCode: 'EMP001' }]); } catch (e) { dupCreate = e; }
assert('duplicate create rejected (409)', dupCreate && dupCreate.status === 409, dupCreate?.message);

let dupUpdate = null;
try {
  // An UPDATE that would leave two records resolving to the same key (case/space
  // insensitive) is rejected — the whole candidate array is validated.
  assertNoDuplicateEmployeeCodes([{ code: 'EMP001' }, { code: ' emp001 ' }]);
} catch (e) { dupUpdate = e; }
assert('duplicate update rejected (409, normalized keys)', dupUpdate && dupUpdate.status === 409, dupUpdate?.message);


let selfMgrSvc = null;
const smBefore = storeState();
try { await adminService.setManager(admin, 'EMP003', 'EMP003'); } catch (e) { selfMgrSvc = e; }
assert('self-manager A→A via setManager rejected (400)', selfMgrSvc && selfMgrSvc.status === 400, selfMgrSvc?.message);
assert('self-manager rejection left store untouched', storeState() === smBefore);
const smAudit = lastRejected('relationship');
assert('self-manager rejection audited with detail "hierarchy cycle"', smAudit && smAudit.change?.detail === 'hierarchy cycle',
  JSON.stringify(smAudit?.change));

// A→B→A: EMP002 already reports to EMP001; make EMP001 report to EMP002.
let cycSvc = null;
const cycBefore = storeState();
try { await adminService.setManager(admin, 'EMP001', 'EMP002'); } catch (e) { cycSvc = e; }
assert('indirect cycle A→B→A via setManager rejected (409)', cycSvc && cycSvc.status === 409, cycSvc?.message);
assert('cycle rejection left store untouched', storeState() === cycBefore);

// ── 8-9. Valid moves: single-root, multi-root, move to valid manager ─────────
console.log('── 8-9. Valid moves (root / multi-root / valid manager) ──');
let validRoot = null;
try { assertOrgIntegrity([{ code: 'R1' }, { code: 'E1', managerCode: 'R1' }]); } catch (e) { validRoot = e; }
assert('valid single-root org passes integrity', !validRoot, validRoot?.message);

let multiRoot = null;
try { assertOrgIntegrity([{ code: 'R1' }, { code: 'R2' }, { code: 'E1', managerCode: 'R1' }, { code: 'E2', managerCode: 'R2' }]); } catch (e) { multiRoot = e; }
assert('valid multi-root org passes integrity (roots preserved)', !multiRoot, multiRoot?.message);

const move = await adminService.setManager(admin, 'EMP003', 'EMP001');
assert('moving EMP003 to valid manager EMP001 succeeds', move.ok);
assert('relationship EMP003→EMP001 saved', getRelationships().some((r) => r.employeeCode === 'EMP003' && r.managerCode === 'EMP001'));
assert('EMP003 still has exactly one active edge (versioned, not duplicated)',
  getRelationships().filter((r) => r.employeeCode === 'EMP003').length === 1);

const toRoot = await adminService.setManager(admin, 'EMP004', null);
assert('moving EMP004 to root (null manager) succeeds — multi-root preserved', toRoot.ok);
assert('root edge stored as null managerCode', getRelationships().some((r) => r.employeeCode === 'EMP004' && r.managerCode == null));
const roots = buildOrgSnapshot(getEmployees(), getRelationships()).roots;
assert('org now has multiple roots (EMP001 + EMP004)', roots.length >= 2 && roots.includes('EMP001') && roots.includes('EMP004'), `roots=${roots}`);

// ── 10. Rejected write is audited (aggregate) ────────────────────────────────
console.log('── 10. Rejected-write audit trail ──');
const rejected = listAudit({ limit: 50 }).filter((e) => e.change?.action === 'rejected');
assert('at least 4 rejected events recorded', rejected.length >= 4, `got ${rejected.length}`);
assert('every rejected event has a safe detail (no raw employee data in detail)',
  rejected.every((e) => ['duplicate employeeCode', 'hierarchy cycle', 'missing manager', 'org integrity violation'].includes(e.change?.detail)),
  JSON.stringify(rejected.map((e) => e.change?.detail)));
assert('rejected events do NOT bump the policy version (no snapshot written)', rejected.every((e) => e.previous == null && e.next == null));

// ── cleanup ──────────────────────────────────────────────────────────────────
fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
