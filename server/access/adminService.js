// adminService.js — Admin configuration operations (read + write separated).
//
// Read operations are pure queries against the store. Write operations:
//   - validate input against the domain model,
//   - apply the change,
//   - bump the policy version (invalidates identity/policy-scoped caches),
//   - record an audit event (who/what/when/previous/new/policyVersion).
//
// This module does NOT perform authorization. The route layer (adminRoutes.js)
// must enforce authenticated-admin access before calling any write here. The
// actor passed in is derived from the signed JWT, never from the request body.

import {
  validateProfile,
  validatePolicy,
  validateSourceLink,
  nextVersion,
  nowIso,
  stableId,
  employeeKey,
  ACCESS_PROFILE_CODES,
} from './accessModel.js';
import {
  getProfiles, saveProfiles,
  getPolicies, savePolicies,
  getSourceLinks, saveSourceLinks,
  getEmployees, saveEmployees,
  getRelationships, saveRelationships,
  getProfile,
  getProfilesMap,
  bumpPolicyVersion,
  getPolicyVersion,
} from './accessStore.js';
import { buildOrgSnapshot, resolveAccess } from './scopeResolver.js';
import { evaluatePolicies, isCompensationField, isSensitiveResource } from './policyEngine.js';
import { POLICY_EFFECTS } from './accessModel.js';
import { recordAudit, listAudit, findPreviousSnapshot } from './auditStore.js';

// ── Read (no audit) ──────────────────────────────────────────────────────────
export const readAccess = {
  profiles: () => getProfiles(),
  profile: (code) => getProfile(code),
  policies: () => getPolicies(),
  sourceLinks: () => getSourceLinks(),
  employees: () => getEmployees(),
  relationships: () => getRelationships(),
  audit: (opts) => listAudit(opts),
  policyVersion: () => getPolicyVersion(),
};

// ── Write helpers ────────────────────────────────────────────────────────────
function applyAndAudit(actor, entity, action, entityId, previous, next) {
  const policyVersion = bumpPolicyVersion();
  recordAudit(actor, { entity, action, entityId }, { previous, next, policyVersion });
  return { ok: true, policyVersion };
}

// ── Profile updates ──────────────────────────────────────────────────────────
export function updateProfile(actor, profileCode, patch) {
  const profiles = getProfiles();
  const idx = profiles.findIndex((p) => p.profileCode === profileCode);
  if (idx === -1) { const e = new Error('Profile not found'); e.status = 404; throw e; }

  const previous = profiles[idx];
  const next = {
    ...previous,
    ...patch,
    profileCode,
    version: nextVersion(previous.version),
    updatedAt: nowIso(),
  };
  const errs = validateProfile(next);
  if (errs.length) { const e = new Error('Invalid profile: ' + errs.join('; ')); e.status = 400; throw e; }

  profiles[idx] = next;
  saveProfiles(profiles);
  return applyAndAudit(actor, 'profile', 'update', profileCode, previous, next);
}

// ── Policy CRUD ──────────────────────────────────────────────────────────────
export function createPolicy(actor, policy) {
  const policies = getPolicies();
  const next = {
    ...policy,
    policyId: policy.policyId || stableId('pol', policy.resourceType, policy.resourceName, policy.subjectType, policy.subjectId ?? ''),
    version: 1,
    createdAt: nowIso(),
  };
  const errs = validatePolicy(next);
  if (errs.length) { const e = new Error('Invalid policy: ' + errs.join('; ')); e.status = 400; throw e; }
  policies.push(next);
  savePolicies(policies);
  return applyAndAudit(actor, 'policy', 'create', next.policyId, null, next);
}

export function updatePolicy(actor, policyId, patch) {
  const policies = getPolicies();
  const idx = policies.findIndex((p) => p.policyId === policyId);
  if (idx === -1) { const e = new Error('Policy not found'); e.status = 404; throw e; }
  const previous = policies[idx];
  const next = { ...previous, ...patch, policyId, version: nextVersion(previous.version), updatedAt: nowIso() };
  const errs = validatePolicy(next);
  if (errs.length) { const e = new Error('Invalid policy: ' + errs.join('; ')); e.status = 400; throw e; }
  policies[idx] = next;
  savePolicies(policies);
  return applyAndAudit(actor, 'policy', 'update', policyId, previous, next);
}

export function deletePolicy(actor, policyId) {
  const policies = getPolicies();
  const idx = policies.findIndex((p) => p.policyId === policyId);
  if (idx === -1) { const e = new Error('Policy not found'); e.status = 404; throw e; }
  const [previous] = policies.splice(idx, 1);
  savePolicies(policies);
  return applyAndAudit(actor, 'policy', 'delete', policyId, previous, null);
}

// ── Source link CRUD (with duplicate-ownership prevention) ───────────────────
export function createSourceLink(actor, link) {
  const links = getSourceLinks();
  const errs = validateSourceLink(link);
  if (errs.length) { const e = new Error('Invalid link: ' + errs.join('; ')); e.status = 400; throw e; }

  const sourceId = link.sourceId;
  const employeeCode = employeeKey(link.employeeCode);
  // Duplicate-ownership prevention: reject a second owner unless either the
  // existing link or the new link marks the source as shared.
  const conflict = links.find((l) =>
    l.sourceId === sourceId &&
    employeeKey(l.employeeCode) !== employeeCode &&
    !l.shared &&
    !link.shared
  );
  if (conflict) {
    const e = new Error(`Source ${sourceId} is already owned by ${conflict.employeeCode}`);
    e.status = 409; throw e;
  }

  const next = {
    ...link,
    linkId: link.linkId || stableId('link', sourceId, employeeCode),
    employeeCode,
    enabled: link.enabled !== false,
    version: 1,
    createdAt: nowIso(),
  };
  links.push(next);
  saveSourceLinks(links);
  return applyAndAudit(actor, 'source_link', 'create', next.linkId, null, next);
}

export function updateSourceLink(actor, linkId, patch) {
  const links = getSourceLinks();
  const idx = links.findIndex((l) => l.linkId === linkId);
  if (idx === -1) { const e = new Error('Link not found'); e.status = 404; throw e; }
  const previous = links[idx];
  const next = { ...previous, ...patch, linkId, version: nextVersion(previous.version), updatedAt: nowIso() };
  const errs = validateSourceLink(next);
  if (errs.length) { const e = new Error('Invalid link: ' + errs.join('; ')); e.status = 400; throw e; }
  links[idx] = next;
  saveSourceLinks(links);
  return applyAndAudit(actor, 'source_link', 'update', linkId, previous, next);
}

export function deleteSourceLink(actor, linkId) {
  const links = getSourceLinks();
  const idx = links.findIndex((l) => l.linkId === linkId);
  if (idx === -1) { const e = new Error('Link not found'); e.status = 404; throw e; }
  const [previous] = links.splice(idx, 1);
  saveSourceLinks(links);
  return applyAndAudit(actor, 'source_link', 'delete', linkId, previous, null);
}

// ── Employee profile assignment ──────────────────────────────────────────────
export function assignProfile(actor, employeeCode, profileCode) {
  if (!Object.values(ACCESS_PROFILE_CODES).includes(profileCode)) {
    const e = new Error('Invalid profileCode'); e.status = 400; throw e;
  }
  const employees = getEmployees();
  const key = employeeKey(employeeCode);
  const idx = employees.findIndex((e) => employeeKey(e.employeeCode) === key);
  if (idx === -1) { const e = new Error('Employee not found'); e.status = 404; throw e; }
  const previous = employees[idx];
  const next = { ...previous, accessProfile: profileCode, version: nextVersion(previous.version), updatedAt: nowIso() };
  employees[idx] = next;
  saveEmployees(employees);
  return applyAndAudit(actor, 'employee', 'assign_profile', key, previous, next);
}

// ── Organization relationships (move employee / change manager) ──────────────
export function setManager(actor, employeeCode, managerCode) {
  const relationships = getRelationships();
  const child = employeeKey(employeeCode);
  const mgr = employeeKey(managerCode);
  const existing = relationships.find((r) => employeeKey(r.employeeCode) === child);
  const previous = existing || null;
  const next = {
    relationshipId: existing?.relationshipId || stableId('rel', child, mgr),
    employeeCode: child,
    managerCode: mgr,
    relationshipType: 'reports_to_manager',
    version: nextVersion(existing?.version),
    effectiveFrom: nowIso(),
    effectiveTo: null,
  };
  if (existing) {
    relationships[relationships.indexOf(existing)] = next;
  } else {
    relationships.push(next);
  }
  saveRelationships(relationships);
  return applyAndAudit(actor, 'relationship', 'set_manager', child, previous, next);
}

// ── Rollback ─────────────────────────────────────────────────────────────────
export function rollback(actor, entity, entityId) {
  const previous = findPreviousSnapshot(entity, entityId);
  if (previous == null) { const e = new Error('No previous snapshot to roll back to'); e.status = 404; throw e; }

  if (entity === 'profile') {
    const profiles = getProfiles();
    const idx = profiles.findIndex((p) => p.profileCode === entityId);
    if (idx === -1) { const e = new Error('Profile not found'); e.status = 404; throw e; }
    const cur = profiles[idx];
    profiles[idx] = { ...previous, version: nextVersion(cur.version), updatedAt: nowIso() };
    saveProfiles(profiles);
    return applyAndAudit(actor, 'profile', 'rollback', entityId, cur, profiles[idx]);
  }
  if (entity === 'policy') {
    const policies = getPolicies();
    const idx = policies.findIndex((p) => p.policyId === entityId);
    if (idx === -1) { const e = new Error('Policy not found'); e.status = 404; throw e; }
    const cur = policies[idx];
    policies[idx] = { ...previous, version: nextVersion(cur.version), updatedAt: nowIso() };
    savePolicies(policies);
    return applyAndAudit(actor, 'policy', 'rollback', entityId, cur, policies[idx]);
  }
  if (entity === 'source_link') {
    const links = getSourceLinks();
    const idx = links.findIndex((l) => l.linkId === entityId);
    if (idx === -1) { const e = new Error('Link not found'); e.status = 404; throw e; }
    const cur = links[idx];
    links[idx] = { ...previous, version: nextVersion(cur.version), updatedAt: nowIso() };
    saveSourceLinks(links);
    return applyAndAudit(actor, 'source_link', 'rollback', entityId, cur, links[idx]);
  }
  const e = new Error('Rollback not supported for entity ' + entity); e.status = 400; throw e;
}
// ── Admin "Preview As User" (M3) ─────────────────────────────────────────────
// Evaluates what a SELECTED user would see using the SAME canonical policy
// engine + scope resolver. It NEVER evaluates as the requesting admin/CEO — the
// subject is always the selected user's own identity + access profile, so the
// admin previewing an employee cannot see data outside that employee's scope.
//
// `org` is injected by the route layer (registry active employees + access store
// relationships/profiles) so preview scope mirrors the real org snapshot.
// Returns explicit allowed/redacted/blocked field markers, marks the response as
// preview mode (isPreview:true), and records an audit event. Actor comes from
// the JWT (never the body).
export function previewAsUser(actor, { employeeCode, viewerCode } = {}, org = {}) {
  // `viewerCode` is accepted as an alias for `employeeCode` (older UI payloads).
  // A client-supplied `profileCode` is NEVER honored: the preview subject's
  // identity (code + assigned access profile) always comes from the server-side
  // org data, so an admin cannot fabricate an arbitrary profile/employee combo.
  const code = employeeKey(employeeCode || viewerCode);
  if (!code) { const e = new Error('employeeCode is required'); e.status = 400; throw e; }

  const employees = org.employees || getEmployees();
  const relationships = org.relationships || getRelationships();
  const snapshot = buildOrgSnapshot(employees, relationships);

  const emp = (Array.isArray(employees) ? employees : [])
    .find((e) => employeeKey(e.code ?? e.employeeCode) === code);
  if (!emp || String(emp.status ?? 'active').toLowerCase() === 'removed') {
    const e = new Error('Employee not found'); e.status = 404; throw e;
  }

  const profiles = org.profiles || getProfilesMap();
  const profileByCode = org.profileByCode
    || new Map(getEmployees().map((e) => [employeeKey(e.employeeCode), e.accessProfile]));
  const profileCode = profileByCode.get(code) || ACCESS_PROFILE_CODES.SELF_ONLY;

  // Canonical resolution for the SELECTED user's identity — not the actor's.
  const access = resolveAccess({ employeeCode: code, profileCode }, snapshot, profiles);

  // Representative resource evaluation → allowed / redacted / blocked markers.
  const policies = getPolicies();
  const subject = { profileCode, employeeCode: code, accessProfile: access.accessProfile };
  const fieldVisibility = access.accessProfile?.fieldVisibility || {};
  const representativeResources = [
    { sheet: 'Employee_Profile', field: 'department' },
    { sheet: 'Employee_Profile', field: 'mainWeakness' },
    { sheet: 'Employee_Profile', field: 'retentionRisk' },
    { sheet: 'Salary_History', field: 'Base_Salary' },
    { sheet: 'Salary_History', field: 'Bonus_Months' },
    { sheet: 'Warning_Disciplinary_History', field: 'severity' },
  ];
  const markers = representativeResources.map((r) => {
    const hidden = (fieldVisibility[r.sheet] || []).includes(r.field);
    const dec = evaluatePolicies(subject, r, policies);
    // Distinguish a MATCHED deny/redact from deny-by-default: with no matching
    // policy the engine returns DENY with empty matchedPolicyIds, which must NOT
    // be rendered as 'blocked' for a profile that is explicitly permitted.
    const matchedDeny = dec.effect === POLICY_EFFECTS.DENY && dec.matchedPolicyIds.length > 0;
    const matchedRedact = dec.effect === POLICY_EFFECTS.REDACT;
    let status;
    if (matchedDeny) status = 'blocked';
    else if (matchedRedact || hidden) status = 'redacted';
    else if (isCompensationField(r.field, r.sheet) && !access.accessProfile?.permissions?.canSeeCompensation) {
      status = 'blocked'; // compensation permitted only for privileged profiles
    } else if (isSensitiveResource(r) && !access.accessProfile?.permissions?.canSeeSensitive) {
      status = 'blocked'; // sensitive personal fields require canSeeSensitive
    } else status = 'allowed';
    return { sheet: r.sheet, field: r.field, status, matchedPolicyIds: dec.matchedPolicyIds };
  });

  const policyVersion = getPolicyVersion();
  recordAudit(actor, { entity: 'preview', action: 'preview_as_user', entityId: code }, {
    previous: null,
    next: { profileCode, scope: access.scope, viewerCode: access.viewerCode },
    policyVersion,
  });

  const scopeCodes = access.scopeCodes;
  const scopeSize = scopeCodes === null
    ? (Array.isArray(employees) ? employees.filter((e) => String(e.status ?? 'active').toLowerCase() !== 'removed').length : 0)
    : (scopeCodes ? scopeCodes.size : 0);

  // UI-compatible shapes: `viewer` + `records`. Records carry field STATUS ONLY —
  // never real values — so a preview can never render data outside the selected
  // user's scope. content is intentionally omitted/empty for every record.
  const viewer = {
    employeeCode: code,
    name: emp.name || null,
    profileCode,
    scope: access.scope,
  };
  const records = markers.map((m) => ({
    sheetName: m.sheet,
    fieldName: m.field,
    status: m.status === 'blocked' ? 'blocked' : (m.status === 'redacted' ? 'redacted' : 'visible'),
    content: '',
    reason: m.status === 'blocked'
      ? 'Denied by permission policy'
      : (m.status === 'redacted' ? 'Field hidden by access profile field-visibility' : 'Allowed by profile + policy'),
  }));

  return {
    isPreview: true,
    previewUser: {
      employeeCode: code,
      name: emp.name || null,
      profileCode,
    },
    viewer,
    records,
    viewerCode: access.viewerCode,
    accessProfile: access.accessProfile ? {
      profileCode: access.accessProfile.profileCode,
      label: access.accessProfile.label || null,
      permissions: access.accessProfile.permissions || {},
      fieldVisibility,
    } : null,
    scope: access.scope,
    scopeSize,
    scopeCodesPreview: scopeCodes === null ? null : [...scopeCodes].slice(0, 50),
    isPreviewAll: scopeCodes === null,
    markers,
    policyVersion,
  };
}
