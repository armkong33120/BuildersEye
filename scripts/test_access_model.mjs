// test_access_model.mjs — Unit tests for the normalized access-control layer.
// Run: node scripts/test_access_model.mjs
// No backend/LLM required — pure logic tests.

import {
  buildOrgSnapshot,
  resolveScopeCodes,
  resolveAccess,
  collectSubtree,
  legacyResolveScope,
  evaluatePolicies,
  applyFieldRedactionPolicy,
  legacyRoleForProfile,
  profileForLegacyRole,
  ACCESS_PROFILE_CODES,
  POLICY_EFFECTS,
  RESOURCE_TYPES,
} from '../server/access/index.js';

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

console.log('🧪 Access model unit tests\n');

// ── 1. Compat adapter: legacy role derivation ───────────────────────────────
console.log('── 1. Compatibility adapter ──');
assert('GLOBAL_ADMIN → CEO', legacyRoleForProfile(ACCESS_PROFILE_CODES.GLOBAL_ADMIN) === 'CEO');
assert('HR_PRIVILEGED → HR', legacyRoleForProfile(ACCESS_PROFILE_CODES.HR_PRIVILEGED) === 'HR');
assert('TEAM_MANAGER → Manager', legacyRoleForProfile(ACCESS_PROFILE_CODES.TEAM_MANAGER) === 'Manager');
assert('SELF_ONLY → Employee', legacyRoleForProfile(ACCESS_PROFILE_CODES.SELF_ONLY) === 'Employee');
assert('unknown profile → Employee (deny-by-default)', legacyRoleForProfile('NOPE') === 'Employee');
assert('legacy CEO → GLOBAL_ADMIN', profileForLegacyRole('CEO') === ACCESS_PROFILE_CODES.GLOBAL_ADMIN);
assert('legacy unknown → SELF_ONLY', profileForLegacyRole('BOGUS') === ACCESS_PROFILE_CODES.SELF_ONLY);

// ── 2. Scope resolver: arbitrary depth + multiple roots ─────────────────────
console.log('── 2. Scope resolver ──');
const org = [
  { code: 'CEO', managerCode: null },
  { code: 'CFO', managerCode: 'CEO' },
  { code: 'COO', managerCode: 'CEO' },
  { code: 'MGR1', managerCode: 'COO' },
  { code: 'EMP1', managerCode: 'MGR1' },
  { code: 'EMP2', managerCode: 'MGR1' },
  { code: 'EMP3', managerCode: 'EMP2' },
  { code: 'MGR2', managerCode: 'CFO' },
  { code: 'EMP4', managerCode: 'MGR2' },
  { code: 'ROOT2', managerCode: null },
  { code: 'EMP5', managerCode: 'ROOT2' },
];
const snap = buildOrgSnapshot(org);

assert('multiple C-level roots detected', snap.roots.length === 2, `roots=${snap.roots}`);
assert('GLOBAL_ADMIN → ALL (null)', resolveScopeCodes(ACCESS_PROFILE_CODES.GLOBAL_ADMIN, 'CEO', snap).scopeCodes === null);
assert('HR_PRIVILEGED → ALL (null)', resolveScopeCodes(ACCESS_PROFILE_CODES.HR_PRIVILEGED, 'CEO', snap).scopeCodes === null);

const mgrScope = resolveScopeCodes(ACCESS_PROFILE_CODES.TEAM_MANAGER, 'COO', snap).scopeCodes;
assert('TEAM_MANAGER subtree includes self', mgrScope.has('COO'));
assert('TEAM_MANAGER subtree arbitrary depth (EMP3)', mgrScope.has('EMP3'), `has EMP3=${mgrScope.has('EMP3')}`);
assert('TEAM_MANAGER subtree excludes sibling branch (EMP4)', !mgrScope.has('EMP4'));
assert('TEAM_MANAGER subtree excludes other root (EMP5)', !mgrScope.has('EMP5'));

const selfScope = resolveScopeCodes(ACCESS_PROFILE_CODES.SELF_ONLY, 'EMP1', snap).scopeCodes;
assert('SELF_ONLY sees only self', selfScope.size === 1 && selfScope.has('EMP1'));

// ── 3. Cycle detection ──────────────────────────────────────────────────────
console.log('── 3. Cycle detection ──');
const cyclic = [
  { code: 'A', managerCode: 'B' },
  { code: 'B', managerCode: 'C' },
  { code: 'C', managerCode: 'A' },
];
const cycSnap = buildOrgSnapshot(cyclic);
const cycSubtree = collectSubtree('A', cycSnap);
assert('cycle terminates (no infinite loop)', cycSubtree.size === 3, `size=${cycSubtree.size}`);

// ── 4. Deactivation ─────────────────────────────────────────────────────────
console.log('── 4. Deactivation ──');
const withInactive = [
  { code: 'MGR', managerCode: null },
  { code: 'ACTIVE', managerCode: 'MGR' },
  { code: 'GONE', managerCode: 'MGR', status: 'removed' },
];
const deactSnap = buildOrgSnapshot(withInactive);
const deactScope = resolveScopeCodes(ACCESS_PROFILE_CODES.TEAM_MANAGER, 'MGR', deactSnap).scopeCodes;
assert('deactivated employee excluded from subtree', !deactScope.has('GONE'));
assert('active employee included', deactScope.has('ACTIVE'));

// ── 5. Moving manager (temporal relationship) ───────────────────────────────
console.log('── 5. Moving manager ──');
const moveEmployees = [
  { code: 'MGR_A', managerCode: null },
  { code: 'MGR_B', managerCode: null },
  { code: 'EMP_X', managerCode: 'MGR_A' },
];
const moveRels = [{ employeeCode: 'EMP_X', managerCode: 'MGR_B' }];
const moveSnap = buildOrgSnapshot(moveEmployees, moveRels);
const moveScopeA = resolveScopeCodes(ACCESS_PROFILE_CODES.TEAM_MANAGER, 'MGR_A', moveSnap).scopeCodes;
const moveScopeB = resolveScopeCodes(ACCESS_PROFILE_CODES.TEAM_MANAGER, 'MGR_B', moveSnap).scopeCodes;
assert('moved employee NOT under old manager', !moveScopeA.has('EMP_X'));
assert('moved employee under new manager', moveScopeB.has('EMP_X'));

// ── 6. Policy engine: deny-over-allow + priority ────────────────────────────
console.log('── 6. Policy engine ──');
const policies = [
  { policyId: 'p_allow', subjectType: 'profile', subjectId: null, resourceType: RESOURCE_TYPES.FIELD, resourceName: 'compensation', effect: POLICY_EFFECTS.ALLOW, priority: 10 },
  { policyId: 'p_deny', subjectType: 'profile', subjectId: null, resourceType: RESOURCE_TYPES.FIELD, resourceName: 'compensation', effect: POLICY_EFFECTS.DENY, priority: 1 },
];
const subj = { profileCode: ACCESS_PROFILE_CODES.TEAM_MANAGER, employeeCode: 'EMP1' };
const dec = evaluatePolicies(subj, { sheet: 'Salary_History', field: 'Base_Salary' }, policies);
assert('deny-over-allow wins', dec.effect === POLICY_EFFECTS.DENY, `effect=${dec.effect}`);

const redactPolicies = [
  { policyId: 'p_redact', subjectType: 'profile', subjectId: ACCESS_PROFILE_CODES.TEAM_MANAGER, resourceType: RESOURCE_TYPES.FIELD, resourceName: 'Employee_Profile.mainWeakness', effect: POLICY_EFFECTS.REDACT, priority: 50 },
];
const redactDec = evaluatePolicies(subj, { sheet: 'Employee_Profile', field: 'mainWeakness' }, redactPolicies);
assert('redact matches sheet.field', redactDec.effect === POLICY_EFFECTS.REDACT);

const noMatch = evaluatePolicies(subj, { sheet: 'Career_Timeline', field: 'title' }, redactPolicies);
assert('no matching policy → deny-by-default', noMatch.effect === POLICY_EFFECTS.DENY);

// ── 7. Field redaction ───────────────────────────────────────────────────────
console.log('── 7. Field redaction ──');
const access = { profileCode: ACCESS_PROFILE_CODES.TEAM_MANAGER, accessProfile: { fieldVisibility: { Employee_Profile: ['mainWeakness'] } }, viewerCode: 'EMP1' };
const rec = { sheetName: 'Employee_Profile', fieldName: 'mainWeakness', content: 'secret' };
const redacted = applyFieldRedactionPolicy(rec, access, []);
assert('fieldVisibility redacts', redacted.redacted === true && redacted.content === '[Redacted — Policy]');
const recOk = { sheetName: 'Employee_Profile', fieldName: 'name', content: 'Alice' };
const notRedacted = applyFieldRedactionPolicy(recOk, access, []);
assert('non-hidden field passes through', notRedacted.redacted !== true);

// ── 8. legacyResolveScope parity ────────────────────────────────────────────
console.log('── 8. Legacy resolveScope parity ──');
const idGraph = { identities: org.map((e, i) => ({ pk: i + 1, code: e.code, managerCode: e.managerCode })) };
const ceoPk = 1, cooPk = 3, emp3Pk = 7, emp4Pk = 9;
assert('legacy CEO sees all', legacyResolveScope('CEO', ceoPk, emp4Pk, idGraph) === true);
assert('legacy Manager sees descendant', legacyResolveScope('Manager', cooPk, emp3Pk, idGraph) === true);
assert('legacy Manager does NOT see sibling', legacyResolveScope('Manager', cooPk, emp4Pk, idGraph) === false);
assert('legacy Employee sees self only', legacyResolveScope('Employee', emp3Pk, emp3Pk, idGraph) === true);
assert('legacy Employee does NOT see other', legacyResolveScope('Employee', emp3Pk, emp4Pk, idGraph) === false);

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);

assert('moved employee NOT under old manager', !moveScopeA.has('EMP_X'));
assert('moved employee under new manager', moveScopeB.has('EMP_X'));
