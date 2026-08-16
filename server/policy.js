// server/policy.js — DEPRECATED legacy shim.
//
// Kept ONLY for archive/back-compat tests. No active chat path imports this
// module: chatController uses the canonical engine (server/access/*) directly.
// Every decision here DELEGATES to the canonical layer so the shim can never
// drift from production behavior:
//   - checkQueryPolicy    → canonicalQueryPolicy      (access/policyEngine.js)
//   - resolveScope        → legacyResolveScope        (access/scopeResolver.js)
//   - applyFieldRedaction → applyFieldRedactionPolicy (access/policyEngine.js)
//
// Static data (VIEWER_ROLES / SENSITIVE_FIELDS) is re-exported for back-compat
// only; the canonical VIEWER_ROLES now lives in access/policyEngine.js.

import {
  canonicalQueryPolicy,
  applyFieldRedactionPolicy,
  VIEWER_ROLES,
} from './access/policyEngine.js';
import { legacyResolveScope } from './access/scopeResolver.js';
import { SEED_PROFILES, SEED_POLICIES } from './access/accessModel.js';
import { profileForLegacyRole } from './access/compatAdapter.js';

// Re-export the canonical role-capability map (searchIndex.js back-compat).
export { VIEWER_ROLES };

export const SENSITIVE_FIELDS = {
  'Employee_Profile': ['mainWeakness', 'retentionRisk', 'successionPotential'],
};

// Map a legacy role string to the canonical access context. The deprecated
// shim maps the flat role to the SEEDED profile so decisions match the
// canonical engine (admin profile edits only affect the live access model,
// which is where the chat pipeline reads from).
function accessForRole(viewerRole) {
  const profileCode = profileForLegacyRole(viewerRole);
  return {
    profileCode,
    accessProfile: SEED_PROFILES.find((p) => p.profileCode === profileCode) || null,
    scope: undefined,
    viewerCode: null,
  };
}

// @deprecated — delegates to the canonical query gate (deny-by-default).
// NOTE: for roles outside the four seeded profiles the legacy behavior allowed
// everything; the canonical gate denies compensation queries for unknown
// profiles. That is a deliberate hardening, not a regression for known roles.
export function checkQueryPolicy(query, viewerRole) {
  return canonicalQueryPolicy(query, accessForRole(viewerRole));
}

// @deprecated — delegates to the canonical resolver (legacyResolveScope) so the
// keyword/vector post-filter shares ONE scope boundary with SQL/vector pre-filter.
export function resolveScope(viewerRole, viewerPk, targetPk, identityGraph) {
  return legacyResolveScope(viewerRole, viewerPk, targetPk, identityGraph);
}

// @deprecated — delegates to the canonical policy-driven redaction. As a
// consequence the two previously documented divergences (HR-on-others sensitive
// fields, Manager-self sensitive fields) now resolve to canonical behavior.
export function applyFieldRedaction(record, viewerRole, viewerPk, targetPk) {
  return applyFieldRedactionPolicy(record, accessForRole(viewerRole), SEED_POLICIES);
}
