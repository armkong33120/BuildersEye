// test_admin_service.mjs — Unit tests for admin config operations + audit.
// Run: node scripts/test_admin_service.mjs
// Uses a temp ACCESS_DATA_DIR so it never touches real runtime data.

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-access-test-'));
process.env.ACCESS_DATA_DIR = TMP;

const {
  seedAccessModel,
  getProfiles, getPolicies, getSourceLinks, getEmployees, getRelationships,
  getPolicyVersion,
  listAudit,
  adminService,
  ACCESS_PROFILE_CODES,
} = await import('../server/access/index.js');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

const admin = { username: 'ceo', employeeId: 1, role: 'CEO' };

console.log('🧪 Admin service unit tests\n');

// ── Seed ─────────────────────────────────────────────────────────────────────
const seed = seedAccessModel({
  employees: [
    { code: 'EMP001', pk: 1, name: 'CEO', jobTitle: 'CEO', roleGroup: 'CEO', department: 'Executive', managerCode: '' },
    { code: 'EMP002', pk: 2, name: 'Mgr', jobTitle: 'Manager', department: 'Sales', managerCode: 'EMP001' },
    { code: 'EMP003', pk: 3, name: 'Emp', jobTitle: 'Staff', department: 'Sales', managerCode: 'EMP002' },
    { code: 'EMP004', pk: 4, name: 'HR', jobTitle: 'HR Manager', department: 'HR & Admin', managerCode: 'EMP001' },
  ],
});
console.log('── Seed ──');
assert('seeded 4 profiles', getProfiles().length === 4, `got ${getProfiles().length}`);
assert('seeded 2 policies', getPolicies().length === 2);
assert('seeded 4 employees', getEmployees().length === 4);
assert('HR & Admin → HR_PRIVILEGED (bug fix)', getEmployees().find(e => e.employeeCode === 'EMP004')?.accessProfile === ACCESS_PROFILE_CODES.HR_PRIVILEGED);
assert('CEO → GLOBAL_ADMIN', getEmployees().find(e => e.employeeCode === 'EMP001')?.accessProfile === ACCESS_PROFILE_CODES.GLOBAL_ADMIN);

// ── Policy version bump ──────────────────────────────────────────────────────
console.log('── Policy version ──');
const v0 = getPolicyVersion();
await adminService.updateProfile(admin, ACCESS_PROFILE_CODES.TEAM_MANAGER, { label: 'Team Manager v2' });
const v1 = getPolicyVersion();
assert('write bumps policy version', v1 > v0, `v0=${v0} v1=${v1}`);

// ── Profile update + audit ───────────────────────────────────────────────────
console.log('── Profile update + audit ──');
const prof = getProfiles().find(p => p.profileCode === ACCESS_PROFILE_CODES.TEAM_MANAGER);
assert('profile version incremented', prof.version >= 2, `version=${prof.version}`);
assert('profile label updated', prof.label === 'Team Manager v2');
const audit = listAudit({ limit: 10 });

// ── Policy CRUD ──────────────────────────────────────────────────────────────
console.log('── Policy CRUD ──');
await adminService.createPolicy(admin, {
  subjectType: 'profile', subjectId: ACCESS_PROFILE_CODES.SELF_ONLY,
  resourceType: 'field', resourceName: 'Salary_History.Base_Salary',
  effect: 'deny', priority: 90,
});
const newPol = getPolicies().find(p => p.resourceName === 'Salary_History.Base_Salary');
assert('new policy present', !!newPol);
const upd = await adminService.updatePolicy(admin, newPol.policyId, { priority: 95 });
assert('policy updated', upd.ok);
assert('policy priority updated', getPolicies().find(p => p.policyId === newPol.policyId).priority === 95);
const del = await adminService.deletePolicy(admin, newPol.policyId);
assert('policy deleted', del.ok && !getPolicies().some(p => p.policyId === newPol.policyId));

// ── Source link duplicate-ownership prevention ────────────────────────────────
console.log('── Source link duplicate ownership ──');
await adminService.createSourceLink(admin, { sourceId: 'onedrive/EMP001.xlsx', employeeCode: 'EMP001' });
let dupErr = null;
try { await adminService.createSourceLink(admin, { sourceId: 'onedrive/EMP001.xlsx', employeeCode: 'EMP002' }); }
catch (e) { dupErr = e; }
assert('duplicate ownership rejected (409)', dupErr && dupErr.status === 409, dupErr?.message);
const shared = await adminService.createSourceLink(admin, { sourceId: 'onedrive/EMP001.xlsx', employeeCode: 'EMP002', shared: true });
assert('shared source allowed', shared.ok);

// ── Assign profile ───────────────────────────────────────────────────────────
console.log('── Assign profile ──');
await adminService.assignProfile(admin, 'EMP003', ACCESS_PROFILE_CODES.TEAM_MANAGER);
assert('employee profile reassigned', getEmployees().find(e => e.employeeCode === 'EMP003')?.accessProfile === ACCESS_PROFILE_CODES.TEAM_MANAGER);
let badProfile = null;
try { await adminService.assignProfile(admin, 'EMP003', 'BOGUS'); } catch (e) { badProfile = e; }
assert('invalid profile rejected (400)', badProfile && badProfile.status === 400);

// ── Set manager (move employee) ──────────────────────────────────────────────
console.log('── Set manager ──');
await adminService.setManager(admin, 'EMP003', 'EMP001');
assert('relationship created', getRelationships().some(r => r.employeeCode === 'EMP003' && r.managerCode === 'EMP001'));
await adminService.setManager(admin, 'EMP003', 'EMP002');
const rels = getRelationships().filter(r => r.employeeCode === 'EMP003');
assert('relationship versioned on change', rels.length === 1 && rels[0].managerCode === 'EMP002' && rels[0].version >= 2);

// ── Rollback ─────────────────────────────────────────────────────────────────
console.log('── Rollback ──');
const beforeRollback = getProfiles().find(p => p.profileCode === ACCESS_PROFILE_CODES.TEAM_MANAGER).label;
await adminService.updateProfile(admin, ACCESS_PROFILE_CODES.TEAM_MANAGER, { label: 'CHANGED' });
const rb = await adminService.rollback(admin, 'profile', ACCESS_PROFILE_CODES.TEAM_MANAGER);
assert('rollback ok', rb.ok);
const afterRollback = getProfiles().find(p => p.profileCode === ACCESS_PROFILE_CODES.TEAM_MANAGER).label;
assert('rollback restored previous label', afterRollback === beforeRollback, `before=${beforeRollback} after=${afterRollback}`);

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);

assert('audit event recorded', audit.length >= 1);
assert('audit has actor (from JWT, not body)', audit[0].actor.username === 'ceo');
assert('audit has previous snapshot', audit[0].previous != null);
assert('audit has policyVersion', typeof audit[0].policyVersion === 'number');
