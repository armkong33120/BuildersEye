// compatAdapter.js — Backward-compatibility adapter.
//
// The legacy system exposed a flat 4-role string (`CEO`/`HR`/`Manager`/
// `Employee`) on `viewer.role` and in the JWT. The normalized model carries
// authorization in an `accessProfile` pointer instead.
//
// This adapter DERIVES the legacy role string from the access profile so the
// existing JWT/frontend/engine consumers keep working unchanged during the
// transition. The role is never stored as truth — it is computed on demand.

import { ACCESS_PROFILE_CODES } from './accessModel.js';

// Canonical mapping: accessProfile code → legacy role string.
export const PROFILE_TO_LEGACY_ROLE = {
  [ACCESS_PROFILE_CODES.GLOBAL_ADMIN]: 'CEO',
  [ACCESS_PROFILE_CODES.HR_PRIVILEGED]: 'HR',
  [ACCESS_PROFILE_CODES.TEAM_MANAGER]: 'Manager',
  [ACCESS_PROFILE_CODES.SELF_ONLY]: 'Employee',
};

// Reverse mapping: legacy role → accessProfile code (for migration/seed).
export const LEGACY_ROLE_TO_PROFILE = {
  CEO: ACCESS_PROFILE_CODES.GLOBAL_ADMIN,
  HR: ACCESS_PROFILE_CODES.HR_PRIVILEGED,
  Manager: ACCESS_PROFILE_CODES.TEAM_MANAGER,
  Employee: ACCESS_PROFILE_CODES.SELF_ONLY,
};

// Derive the legacy role string from an access profile code.
// Unknown/empty profile → deny-by-default 'Employee' (SELF_ONLY), never 'CEO'.
export function legacyRoleForProfile(profileCode) {
  return PROFILE_TO_LEGACY_ROLE[profileCode] || 'Employee';
}

// Derive the access profile code from a legacy role string (for seeding/migration).
// Unknown role → SELF_ONLY (deny-by-default), never GLOBAL_ADMIN.
export function profileForLegacyRole(role) {
  return LEGACY_ROLE_TO_PROFILE[role] || ACCESS_PROFILE_CODES.SELF_ONLY;
}

// Build a compatibility `viewer` object from a resolved access context.
// `accessContext` is the output of resolveAccess (see scopeResolver.js) or a
// minimal { accessProfile } object. Returns the legacy shape:
//   { role, employeeId, accessProfile, profileCode, scope }
export function buildLegacyViewer(accessContext, employeeId) {
  const profileCode = accessContext?.accessProfile?.profileCode
    || accessContext?.profileCode
    || ACCESS_PROFILE_CODES.SELF_ONLY;
  return {
    role: legacyRoleForProfile(profileCode),
    employeeId: employeeId ?? null,
    accessProfile: accessContext?.accessProfile || null,
    profileCode,
    scope: accessContext?.scope || null,
  };
}

// Map a legacy `viewer` object (as produced by resolveViewer in index.js) into
// the normalized access profile code. Used where legacy callers still pass
// `viewer.role` around but we need the profile for the policy engine.
export function profileCodeForViewer(viewer) {
  if (viewer?.profileCode) return viewer.profileCode;
  if (viewer?.accessProfile?.profileCode) return viewer.accessProfile.profileCode;
  return profileForLegacyRole(viewer?.role);
}
