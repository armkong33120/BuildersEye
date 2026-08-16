// test_legacy_shim_parity.mjs — Legacy scope/redaction shim review (Phase 6).
//
// Enumerates every legacy compatibility shim, its callers, and proves that on
// the REACHABLE decision space each shim agrees with the canonical layer
// (server/access/scopeResolver.js + policyEngine.js). A future migration of a
// caller onto the canonical layer is therefore test-gated.
//
// Shims audited:
//   1. server/policy.js:resolveScope            → delegates to canonical legacyResolveScope
//   2. server/access/scopeResolver.js:legacyResolveScope → canonical shim itself
//   3. server/policy.js:applyFieldRedaction      → delegates to canonical applyFieldRedactionPolicy.
//                                                  Chat uses the canonical engine directly; the two
//                                                  formerly documented divergences (HR-on-others
//                                                  sensitive, Manager-self sensitive) are RESOLVED.
//   4. server/policy.js:checkQueryPolicy         → delegates to canonicalQueryPolicy (canonical
//                                                  query gate used by the chat pipeline).
//   5. server/chatController.js resolveScope duplicate gate → delegates to canonical (L2)
//
// Parity matrix: for every (role→profile, viewer, target) in a 5-node org, and
// every representative field, legacy decision === canonical decision.
//
// Usage: node scripts/test_legacy_shim_parity.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-shim-'));
process.env.ACCESS_DATA_DIR = TMP;

const { SEED_PROFILES, SEED_POLICIES, ACCESS_PROFILE_CODES } =
  await import('../server/access/accessModel.js');
const accStore = await import('../server/access/accessStore.js');
const { resolveScopeCodes, buildOrgSnapshot, legacyResolveScope } =
  await import('../server/access/scopeResolver.js');
const { applyFieldRedactionPolicy } = await import('../server/access/policyEngine.js');
const legacy = await import('../server/policy.js');

accStore.saveProfiles(SEED_PROFILES);
accStore.savePolicies(SEED_POLICIES);
const profilesMap = accStore.getProfilesMap();
const policies = accStore.getPolicies();

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

// ── Fixture: 5-node org (CEO → Manager → 2 staff, + HR) ──────────────────────
const org = [
  { code: 'EMP001', pk: 1, name: 'CEO', roleGroup: 'CEO', managerCode: '', status: 'active' },
  { code: 'EMP002', pk: 2, name: 'Mgr', roleGroup: 'Manager', managerCode: 'EMP001', status: 'active' },
  { code: 'EMP003', pk: 3, name: 'A', roleGroup: 'Employee', managerCode: 'EMP002', status: 'active' },
  { code: 'EMP004', pk: 4, name: 'B', roleGroup: 'Employee', managerCode: 'EMP002', status: 'active' },
  { code: 'EMP005', pk: 5, name: 'HR', roleGroup: 'HR', managerCode: 'EMP001', status: 'active' },
];
accStore.saveEmployees(org.map((e) => ({ employeeCode: e.code, code: e.code, managerCode: e.managerCode, status: 'active' })));
const snapshot = buildOrgSnapshot(org);
const ROLE_TO_PROFILE = { CEO: ACCESS_PROFILE_CODES.GLOBAL_ADMIN, HR: ACCESS_PROFILE_CODES.HR_PRIVILEGED, Manager: ACCESS_PROFILE_CODES.TEAM_MANAGER, Employee: ACCESS_PROFILE_CODES.SELF_ONLY };

// ═══ 1. Scope shim parity ════════════════════════════════════════════════════
console.log('\n── 1. resolveScope (policy.js) ≡ canonical scopeCodes ──');
let scopeChecks = 0, scopeOk = 0;
for (const viewer of org) {
  for (const role of Object.keys(ROLE_TO_PROFILE)) {
    const canonical = resolveScopeCodes(ROLE_TO_PROFILE[role], viewer.code, snapshot);
    for (const target of org) {
      const legacyDecision = legacy.resolveScope(role, viewer.pk, target.pk, { identities: org });
      const canonicalDecision = canonical.scopeCodes === null ? true : canonical.scopeCodes.has(target.code);
      scopeChecks++;
      if (legacyDecision === canonicalDecision) scopeOk++;
      else assert(`scope parity ${role}/${viewer.code}→${target.code}`, false,
        `legacy=${legacyDecision} canonical=${canonicalDecision}`);
    }
  }
}
assert(`scope shim parity (${scopeOk}/${scopeChecks})`, scopeOk === scopeChecks);

// ═══ 2. Redaction shim parity (reachable space only: target ∈ scope) ══════════
console.log('\n── 2. applyFieldRedaction (policy.js) ≡ applyFieldRedactionPolicy ──');
const FIELDS = ['name', 'mainWeakness', 'retentionRisk', 'Base_Salary', 'Bonus_Months'];
const SHEETS = ['Employee_Profile', 'Salary_History'];
// The two formerly documented divergences are RESOLVED: policy.js now delegates
// to the canonical engine (and the chat pipeline calls the canonical engine
// directly), so over the reachable decision space legacy === canonical with
// ZERO divergences:
//   A) HR-on-others sensitive fields: legacy redacted them; canonical allows
//      (HR_PRIVILEGED.canSeeSensitive=true). Chat now behaves canonically.
//   B) Manager-self sensitive fields: legacy self-exemption allowed them;
//      canonical applies the TEAM_MANAGER REDACT policy regardless of self.
//      Chat now behaves canonically (Manager's own sensitive fields redacted).
const EXPECTED_DIVERGENT = new Set(); // empty — full parity by delegation

let redactChecks = 0, redactOk = 0;
const actualDivergent = new Set();
for (const viewer of org) {
  for (const role of Object.keys(ROLE_TO_PROFILE)) {
    const profileCode = ROLE_TO_PROFILE[role];
    const canonical = resolveScopeCodes(profileCode, viewer.code, snapshot);
    const access = {
      profileCode,
      accessProfile: profilesMap.get(profileCode),
      viewerCode: viewer.code,
    };
    for (const target of org) {
      // reachable: only targets inside the viewer's canonical scope can ever
      // reach the redaction stage in the real chat pipeline.
      const inScope = canonical.scopeCodes === null || canonical.scopeCodes.has(target.code);
      if (!inScope) continue;
      for (const sheet of SHEETS) {
        for (const field of FIELDS) {
          const rec = { sheetName: sheet, fieldName: field, content: 'x' };
          const legacyOut = legacy.applyFieldRedaction(rec, role, viewer.pk, target.pk);
          const canonOut = applyFieldRedactionPolicy(rec, access, policies);
          redactChecks++;
          if (legacyOut.redacted === canonOut.redacted) redactOk++;
          else actualDivergent.add(`${role}/${viewer.code}→${target.code} ${sheet}.${field}`);
        }
      }
    }
  }
}
assert(`redaction accounting (parity + documented divergences = total, ${redactOk}/${redactChecks})`,
  redactOk + actualDivergent.size === redactChecks, `${actualDivergent.size} divergences`);
assert(`all divergences are exactly the documented set (${actualDivergent.size}/${EXPECTED_DIVERGENT.size})`,
  actualDivergent.size === EXPECTED_DIVERGENT.size
  && [...actualDivergent].every((d) => EXPECTED_DIVERGENT.has(d)),
  `unexpected: ${[...actualDivergent].filter((d) => !EXPECTED_DIVERGENT.has(d)).join('; ').slice(0, 300)}`);
console.log('  Both formerly documented redaction divergences (HR-on-others sensitive,');
console.log('  Manager-self sensitive) are RESOLVED: chat uses the canonical engine and the');
console.log('  legacy shim delegates to it — no divergences remain on the reachable space.');


// ═══ 3. checkQueryPolicy ≡ canonicalQueryPolicy (query-intent gate parity) ════
console.log('\n── 3. checkQueryPolicy (policy.js) ≡ canonicalQueryPolicy ──');
const { canonicalQueryPolicy } = await import('../server/access/policyEngine.js');

// Query-intent matrix: role × query category. The canonical gate must produce
// EXACTLY the legacy status for the four seeded profiles, and the concrete
// expectations pin the canonical gate's own behavior (not just delegation).
const QUERY_CATEGORIES = [
  ['salary', 'เงินเดือนเท่าไหร่'],
  ['bonus', 'โบนัสของ EMP003 เท่าไหร่'],
  ['warning', 'ประวัติการตักเตือนของ EMP003'],
  ['personal', 'EMP003 เบอร์โทรศัพท์คืออะไร'],
  ['general', 'EMP002 คือใคร'],
  ['team-aggregate', 'ทีมฉันเงินเดือนเฉลี่ยเท่าไหร่'],
  ['company-wide', 'เงินเดือนเฉลี่ยทั้งบริษัทเท่าไหร่'],
];
const EXPECTED_QUERY_STATUS = {
  CEO: { salary: 'Allowed', bonus: 'Allowed', warning: 'Allowed', personal: 'Allowed', general: 'Allowed', 'team-aggregate': 'Allowed', 'company-wide': 'Allowed' },
  HR: { salary: 'Allowed', bonus: 'Allowed', warning: 'Allowed', personal: 'Allowed', general: 'Allowed', 'team-aggregate': 'Allowed', 'company-wide': 'Allowed' },
  Manager: { salary: 'Blocked', bonus: 'Blocked', warning: 'Allowed', personal: 'Allowed', general: 'Allowed', 'team-aggregate': 'Allowed', 'company-wide': 'Blocked' },
  Employee: { salary: 'Blocked', bonus: 'Blocked', warning: 'Allowed', personal: 'Allowed', general: 'Allowed', 'team-aggregate': 'Blocked', 'company-wide': 'Blocked' },
};

let queryChecks = 0, queryOk = 0;
for (const role of Object.keys(ROLE_TO_PROFILE)) {
  const accessForRole = {
    profileCode: ROLE_TO_PROFILE[role],
    accessProfile: profilesMap.get(ROLE_TO_PROFILE[role]),
    scope: undefined,
  };
  for (const [category, query] of QUERY_CATEGORIES) {
    const legacyStatus = legacy.checkQueryPolicy(query, role).status;
    const canonicalStatus = canonicalQueryPolicy(query, accessForRole).status;
    queryChecks++;
    // 1) canonical ≡ legacy for the same subject (the migration contract).
    if (legacyStatus === canonicalStatus) queryOk++;
    // 2) concrete expected behavior — pins the canonical gate itself.
    assert(`${role} × ${category}: canonical=${canonicalStatus} (expected ${EXPECTED_QUERY_STATUS[role][category]})`,
      canonicalStatus === EXPECTED_QUERY_STATUS[role][category], `got ${canonicalStatus}`);
  }
}
assert(`query-policy shim parity (${queryOk}/${queryChecks})`, queryOk === queryChecks);

// Deny-by-default hardening: an UNKNOWN profile is blocked on compensation
// queries by the canonical gate (legacy allowed unknown roles — documented).
const unknownAccess = { profileCode: 'BOGUS', accessProfile: null, scope: undefined };
assert('canonical deny-by-default blocks unknown profile compensation query',
  canonicalQueryPolicy('เงินเดือน', unknownAccess).status === 'Blocked');
assert('canonical blocked reason carries no employee data',
  canonicalQueryPolicy('โบนัสของ EMP001 เท่าไหร่', { profileCode: 'SELF_ONLY', accessProfile: null }).reason
  === 'Query blocked by governance policy.');
assert('canonical blocked decision lists matched policy ids',
  Array.isArray(canonicalQueryPolicy('เงินเดือน', { profileCode: 'SELF_ONLY', accessProfile: null }).matchedPolicyIds));

// ═══ 4. Canonical legacyResolveScope is the single canonical-backed shim ═══════
console.log('\n── 4. legacyResolveScope consistency ──');
assert('legacyResolveScope Manager sees direct report', legacyResolveScope('Manager', 2, 3, { identities: org }) === true);
assert('legacyResolveScope Manager does not see sibling (HR)', legacyResolveScope('Manager', 2, 5, { identities: org }) === false);
assert('legacyResolveScope unknown role denies', legacyResolveScope('Bogus', 1, 2, { identities: org }) === false);

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);

