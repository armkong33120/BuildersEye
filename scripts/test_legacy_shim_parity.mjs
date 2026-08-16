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
//   3. server/policy.js:applyFieldRedaction      → legacy role-based redaction (still used by
//                                                  chatController keyword + SQL paths)
//   4. server/policy.js:checkQueryPolicy         → query-intent gate (no canonical equivalent yet)
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
// DOCUMENTED intentional divergences (over-restriction, not leaks):
//   A) legacy chat redacts sensitive Employee_Profile fields for the HR role,
//      while the canonical profile permission (HR_PRIVILEGED.canSeeSensitive=true)
//      and the admin preview allow them.
//   B) legacy applyFieldRedaction exempts self (viewerPk===targetPk) from redaction,
//      so a Manager sees their OWN mainWeakness/retentionRisk; the canonical engine
//      applies the TEAM_MANAGER REDACT policy regardless of self (profile
//      fieldVisibility is per-profile, not per-target). Canonical behavior is the
//      intended design; legacy self-exemption is stale.
// Chat keeps legacy behavior until a verified migration — this test proves there
// are NO OTHER divergences.
const EXPECTED_DIVERGENT = new Set();
for (const v of org) for (const t of org) {
  for (const f of ['mainWeakness', 'retentionRisk']) {
    // HR × non-self: legacy redacts, canonical allows (canSeeSensitive:true).
    // (HR-self is NOT divergent — legacy self-exemption and canonical both allow.)
    if (v.code !== t.code) EXPECTED_DIVERGENT.add(`HR/${v.code}→${t.code} Employee_Profile.${f}`);
    // Manager-self: legacy self-exemption allows, canonical REDACT policy applies.
    if (v.code === t.code) EXPECTED_DIVERGENT.add(`Manager/${v.code}→${t.code} Employee_Profile.${f}`);
  }
}

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
console.log('  KNOWN INTENTIONAL DIVERGENCES (A) legacy redacts Employee_Profile sensitive fields');
console.log('  for HR on OTHERS (canonical profile canSeeSensitive allows); (B) legacy self-exemption');
console.log('  lets a Manager see their OWN sensitive fields (canonical REDACT policy applies).');
console.log('  Chat migration to the canonical engine is DEFERRED (needs live E2E).');


// ═══ 3. checkQueryPolicy — no canonical equivalent yet (documented, not parity) ═
console.log('\n── 3. checkQueryPolicy (query-intent gate) ──');
assert('Employee compensation query blocked', legacy.checkQueryPolicy('เงินเดือนเท่าไหร่', 'Employee').status === 'Blocked');
assert('Manager individual compensation blocked', legacy.checkQueryPolicy('EMP003 เงินเดือน', 'Manager').status === 'Blocked');
assert('Manager team aggregate allowed', legacy.checkQueryPolicy('ทีมฉันเงินเดือนเฉลี่ย', 'Manager').status === 'Allowed');
assert('CEO never blocked by query policy', legacy.checkQueryPolicy('เงินเดือน', 'CEO').status === 'Allowed');
console.log('  NOTE: checkQueryPolicy has no canonical engine equivalent — migrating it requires a');
console.log('  query-intent→policy bridge. Documented as DEFERRED (test-gated migration).');

// ═══ 4. Canonical legacyResolveScope is the single canonical-backed shim ═══════
console.log('\n── 4. legacyResolveScope consistency ──');
assert('legacyResolveScope Manager sees direct report', legacyResolveScope('Manager', 2, 3, { identities: org }) === true);
assert('legacyResolveScope Manager does not see sibling (HR)', legacyResolveScope('Manager', 2, 5, { identities: org }) === false);
assert('legacyResolveScope unknown role denies', legacyResolveScope('Bogus', 1, 2, { identities: org }) === false);

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);

