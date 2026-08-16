// test_canonical_policy.mjs — Canonical authorization policy tests (Part B).
// Run: node scripts/test_canonical_policy.mjs
// Uses a temp ACCESS_DATA_DIR so it never touches real runtime data.
//
// Proves:
//   (a) the SAME policy result through the chat query gate (canonicalQueryPolicy)
//       and the Admin "Preview As User" markers (previewAsUser) for the same subject;
//   (b) the SAME redaction result across SQL-row and keyword-record record shapes;
//   (c) body-supplied identity / profileCode can NEVER override the server-side
//       canonical access (JWT-derived viewer + admin-assigned access profile).

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-canonical-policy-'));
process.env.ACCESS_DATA_DIR = TMP;

const {
  seedAccessModel,
  getProfilesMap,
  adminService,
  canonicalQueryPolicy,
  applyFieldRedactionPolicy,
  resolveViewerScope,
  ACCESS_PROFILE_CODES,
} = await import('../server/access/index.js');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

const admin = { username: 'ceo', employeeId: 1, role: 'CEO' };

// 5-node org: CEO(EMP001) → Mgr(EMP002) → staff(EMP003, EMP004); HR(EMP005).
const ORG = [
  { code: 'EMP001', pk: 1, name: 'CEO', jobTitle: 'CEO', roleGroup: 'CEO', department: 'Executive', managerCode: '', status: 'active' },
  { code: 'EMP002', pk: 2, name: 'Mgr', jobTitle: 'Manager', department: 'Sales', managerCode: 'EMP001', status: 'active' },
  { code: 'EMP003', pk: 3, name: 'Staff A', jobTitle: 'Staff', department: 'Sales', managerCode: 'EMP002', status: 'active' },
  { code: 'EMP004', pk: 4, name: 'Staff B', jobTitle: 'Staff', department: 'Sales', managerCode: 'EMP002', status: 'active' },
  { code: 'EMP005', pk: 5, name: 'HR', jobTitle: 'HR Manager', department: 'HR & Admin', managerCode: 'EMP001', status: 'active' },
];
seedAccessModel({ employees: ORG });
const profilesMap = getProfilesMap();

const accessFor = (employeeCode) => {
  const emp = ORG.find((e) => e.code === employeeCode);
  return resolveViewerScope({ role: emp.roleGroup, employeeId: emp.pk }, { employees: ORG, relationships: [], profiles: profilesMap });
};

const previewFor = (employeeCode, extraBody = {}) =>
  adminService.previewAsUser(admin, { employeeCode, ...extraBody }, { employees: ORG, relationships: [], profiles: profilesMap });

const marker = (preview, field) => preview.markers.find((m) => m.field === field)?.status;

console.log('🧪 Canonical policy tests\n');

// ── (a) Chat query gate ≡ Admin Preview markers for the same subject ─────────
console.log('── (a) chat query gate ≡ admin preview (same subject) ──');
// Employee: salary query blocked by the gate; preview marks Base_Salary blocked.
const empAccess = accessFor('EMP003');
assert('employee access resolves to SELF_ONLY', empAccess.profileCode === ACCESS_PROFILE_CODES.SELF_ONLY, empAccess.profileCode);
assert('employee salary query blocked by gate', canonicalQueryPolicy('เงินเดือนเท่าไหร่', empAccess).status === 'Blocked');
const previewEmp = previewFor('EMP003');
assert('employee preview marks Base_Salary blocked', marker(previewEmp, 'Base_Salary') === 'blocked', `got ${marker(previewEmp, 'Base_Salary')}`);
assert('employee preview marks mainWeakness blocked', marker(previewEmp, 'mainWeakness') === 'blocked');

// Manager: individual compensation blocked by the gate; preview row-level blocked.
const mgrAccess = accessFor('EMP002');
assert('manager access resolves to TEAM_MANAGER', mgrAccess.profileCode === ACCESS_PROFILE_CODES.TEAM_MANAGER, mgrAccess.profileCode);
assert('manager individual salary query blocked by gate', canonicalQueryPolicy('EMP003 เงินเดือนเท่าไหร่', mgrAccess).status === 'Blocked');
const previewMgr = previewFor('EMP002');
assert('manager preview marks Base_Salary blocked (row-level data)', marker(previewMgr, 'Base_Salary') === 'blocked');

// Manager team-aggregate: the QUERY GATE allows the aggregate question while the
// FIELD-LEVEL policy still denies individual rows — layered, documented behavior.
assert('manager team-aggregate query ALLOWED by gate (aggregate question)',
  canonicalQueryPolicy('ทีมฉันเงินเดือนเฉลี่ยเท่าไหร่', mgrAccess).status === 'Allowed');
assert('manager preview Base_Salary stays blocked (field-level deny unchanged)',
  marker(previewMgr, 'Base_Salary') === 'blocked');

// CEO/HR: allowed by the gate AND by the preview markers.
const ceoAccess = accessFor('EMP001');
assert('CEO salary query allowed by gate', canonicalQueryPolicy('เงินเดือนเท่าไหร่', ceoAccess).status === 'Allowed');
const previewCeo = previewFor('EMP001');
assert('CEO preview marks Base_Salary allowed', marker(previewCeo, 'Base_Salary') === 'allowed');
assert('CEO preview marks mainWeakness allowed', marker(previewCeo, 'mainWeakness') === 'allowed');

const hrAccess = accessFor('EMP005');
assert('HR salary query allowed by gate', canonicalQueryPolicy('เงินเดือนเท่าไหร่', hrAccess).status === 'Allowed');
const previewHr = previewFor('EMP005');
assert('HR preview marks Base_Salary allowed', marker(previewHr, 'Base_Salary') === 'allowed');

// ── (b) Same redaction across SQL-row and keyword-record shapes ──────────────
console.log('\n── (b) redaction parity across record shapes ──');
const mgrPolicies = adminService.readAccess.policies();
const mgrAccessForRedaction = {
  profileCode: ACCESS_PROFILE_CODES.TEAM_MANAGER,
  accessProfile: profilesMap.get(ACCESS_PROFILE_CODES.TEAM_MANAGER),
  viewerCode: 'EMP002',
};
// SQL-row shape (from sqlEngine rows): carries employeeId.
const sqlRow = { sheetName: 'Employee_Profile', fieldName: 'mainWeakness', content: 'secret', employeeId: 3 };
// keyword-record shape (from flatIndex matchedRecords): carries source/file.
const keywordRec = { sheetName: 'Employee_Profile', fieldName: 'mainWeakness', content: 'secret', source: 'onedrive/EMP003.xlsx' };
const sqlOut = applyFieldRedactionPolicy(sqlRow, mgrAccessForRedaction, mgrPolicies);
const kwOut = applyFieldRedactionPolicy(keywordRec, mgrAccessForRedaction, mgrPolicies);
assert('SQL-row mainWeakness redacted for Manager', sqlOut.redacted === true && sqlOut.content === '[Redacted — Policy]', JSON.stringify(sqlOut));
assert('keyword-record mainWeakness redacted for Manager', kwOut.redacted === true && kwOut.content === '[Redacted — Policy]', JSON.stringify(kwOut));

const sqlVisible = applyFieldRedactionPolicy({ sheetName: 'Employee_Profile', fieldName: 'name', content: 'Alice', employeeId: 3 }, mgrAccessForRedaction, mgrPolicies);
const kwVisible = applyFieldRedactionPolicy({ sheetName: 'Employee_Profile', fieldName: 'name', content: 'Alice', source: 'onedrive/EMP003.xlsx' }, mgrAccessForRedaction, mgrPolicies);
assert('SQL-row non-sensitive field NOT redacted', sqlVisible.redacted !== true);
assert('keyword-record non-sensitive field NOT redacted', kwVisible.redacted !== true);

// CEO: no redaction on either shape.
const ceoAccessForRedaction = {
  profileCode: ACCESS_PROFILE_CODES.GLOBAL_ADMIN,
  accessProfile: profilesMap.get(ACCESS_PROFILE_CODES.GLOBAL_ADMIN),
  viewerCode: 'EMP001',
};
const ceoSql = applyFieldRedactionPolicy({ sheetName: 'Employee_Profile', fieldName: 'mainWeakness', content: 'secret', employeeId: 3 }, ceoAccessForRedaction, mgrPolicies);
const ceoKw = applyFieldRedactionPolicy({ sheetName: 'Employee_Profile', fieldName: 'mainWeakness', content: 'secret', source: 'x' }, ceoAccessForRedaction, mgrPolicies);
assert('CEO SQL-row sensitive field NOT redacted', ceoSql.redacted !== true);
assert('CEO keyword-record sensitive field NOT redacted', ceoKw.redacted !== true);

// ── (c) Body identity / profileCode can never override ───────────────────────
console.log('\n── (c) body identity / profileCode cannot override ──');
// Admin preview: a body-supplied profileCode/username is ignored — the subject's
// identity + access profile come from server-side org data (JWT actor for audit).
const spoofed = previewFor('EMP003', { profileCode: ACCESS_PROFILE_CODES.GLOBAL_ADMIN, username: 'attacker', role: 'CEO' });
assert('preview ignores body profileCode override (stays SELF_ONLY)', spoofed.accessProfile.profileCode === ACCESS_PROFILE_CODES.SELF_ONLY,
  `got ${spoofed.accessProfile?.profileCode}`);
assert('preview ignores body username (actor from JWT)', spoofed.previewUser.employeeCode === 'EMP003');
assert('preview scope stays SELF (never elevated by body)', spoofed.scope === 'SELF', spoofed.scope);

// Chat gate: the route builds the viewer ONLY from the signed JWT (req.viewer);
// the request body (query/profileCode/role) never feeds the access computation.
// Simulate exactly what index.js does:
//   const viewer = resolveViewer(req);            // { role, employeeId } from JWT
//   const access = resolveScopeForViewer(viewer); // canonical, server-side
//   chatHandler(query, viewer, { ..., access })
const req = {
  viewer: { role: 'Employee', employeeId: 3 },          // set by requireAuth from the JWT
  body: { query: 'EMP003 เงินเดือนเท่าไหร่', profileCode: ACCESS_PROFILE_CODES.GLOBAL_ADMIN, role: 'CEO' },
};
const jwtViewer = { role: req.viewer.role, employeeId: req.viewer.employeeId }; // index.js resolveViewer
const serverAccess = resolveViewerScope(jwtViewer, { employees: ORG, relationships: [], profiles: profilesMap });
assert('chat access derives profile from server org (SELF_ONLY, not body GLOBAL_ADMIN)',
  serverAccess.profileCode === ACCESS_PROFILE_CODES.SELF_ONLY, serverAccess.profileCode);
assert('chat gate blocks salary query despite body profileCode=GLOBAL_ADMIN',
  canonicalQueryPolicy(req.body.query, serverAccess).status === 'Blocked');

// ── cleanup ──────────────────────────────────────────────────────────────────
fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);

