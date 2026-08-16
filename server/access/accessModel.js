// accessModel.js — Normalized domain model for BuildersEye access control.
//
// This module defines the five normalized entities that replace the flat
// 4-role string enum (CEO/HR/Manager/Employee) as the single source of truth
// for authorization:
//
//   1. Employee                 — identity + org snapshot + accessProfile pointer
//   2. Organization Relationship — temporal directed edges (manager/reports)
//   3. Data Source Link          — which source/sheet feeds which employee
//   4. Permission Policy         — versioned allow/deny/redact rules
//   5. Access Profile            — named bundle of scope + permissions
//
// Design invariants (see docs/domain-model-design.md):
//   - Identity, Organization, and Authorization are separated structurally.
//   - Stable, non-display identifiers are the only keys (employeeCode).
//   - Temporal validity + versioning on employees, relationships, policies.
//   - Deny-by-default: every decision starts from "no access".
//
// This file is PURE (no I/O). Persistence lives in accessStore.js.

import crypto from 'crypto';

// ── Stable ID helpers ────────────────────────────────────────────────────────
// IDs are deterministic (content-addressed) so the same entity always maps to
// the same ID across restarts and nodes. IDs are never derived from display
// names (name/jobTitle/department) — only from stable codes.

export function stableId(prefix, ...parts) {
  const joined = parts.map((p) => String(p ?? '')).join(':');
  const hash = crypto.createHash('sha256').update(joined).digest('hex').slice(0, 16);
  return `${prefix}_${hash}`;
}

export function employeeKey(employeeCode) {
  return String(employeeCode ?? '').trim().toUpperCase();
}

// ── Access profile codes (canonical) ─────────────────────────────────────────
export const ACCESS_PROFILE_CODES = {
  GLOBAL_ADMIN: 'GLOBAL_ADMIN',
  HR_PRIVILEGED: 'HR_PRIVILEGED',
  TEAM_MANAGER: 'TEAM_MANAGER',
  SELF_ONLY: 'SELF_ONLY',
};

// Default scope values (what a profile's scope resolves to at the root).
export const SCOPE_VALUES = {
  ALL: 'ALL',       // whole organization
  SUBTREE: 'SUBTREE', // self + all descendants
  SELF: 'SELF',     // self only
  NONE: 'NONE',     // nothing (deny-by-default fallback)
};

// Policy effects.
export const POLICY_EFFECTS = {
  ALLOW: 'allow',
  DENY: 'deny',
  REDACT: 'redact',
};

// Resource types that policies can target.
export const RESOURCE_TYPES = {
  SOURCE: 'source',
  SHEET: 'sheet',
  FIELD: 'field',
  RECORD: 'record',
};

// ── Seeded access profiles ───────────────────────────────────────────────────
// These reproduce the legacy 4-role behavior so Phase 1 (model + migration) is
// behavior-neutral. The legacy role is DERIVED from these, never stored.
export const SEED_PROFILES = [
  {
    profileId: 'prof_GLOBAL_ADMIN',
    profileCode: ACCESS_PROFILE_CODES.GLOBAL_ADMIN,
    label: 'Global Administrator',
    defaultScope: SCOPE_VALUES.ALL,
    permissions: {
      canSeeAll: true,
      canSeeSensitive: true,
      canSeeCompensation: true,
      canSeeWarnings: true,
      isAdmin: true,
    },
    fieldVisibility: {},      // no redaction
    sourceVisibility: {},     // no source redaction
    version: 1,
  },
  {
    profileId: 'prof_HR_PRIVILEGED',
    profileCode: ACCESS_PROFILE_CODES.HR_PRIVILEGED,
    label: 'HR Privileged',
    defaultScope: SCOPE_VALUES.ALL,
    permissions: {
      canSeeAll: false,
      canSeeSensitive: true,
      canSeeCompensation: true,
      canSeeWarnings: true,
      isAdmin: false,
    },
    fieldVisibility: {},      // HR sees all fields (see design note #8: ALL + redact)
    sourceVisibility: {},
    version: 1,
  },
  {
    profileId: 'prof_TEAM_MANAGER',
    profileCode: ACCESS_PROFILE_CODES.TEAM_MANAGER,
    label: 'Team Manager',
    defaultScope: SCOPE_VALUES.SUBTREE,
    permissions: {
      canSeeAll: false,
      canSeeSensitive: false,
      canSeeCompensation: false,
      canSeeWarnings: true,
      isAdmin: false,
    },
    // Manager may see team aggregate but not individual sensitive fields.
    fieldVisibility: {
      'Employee_Profile': ['mainWeakness', 'retentionRisk', 'successionPotential'],
    },
    sourceVisibility: {},
    version: 1,
  },
  {
    profileId: 'prof_SELF_ONLY',
    profileCode: ACCESS_PROFILE_CODES.SELF_ONLY,
    label: 'Self Only',
    defaultScope: SCOPE_VALUES.SELF,
    permissions: {
      canSeeAll: false,
      canSeeSensitive: false,
      canSeeCompensation: false,
      canSeeWarnings: false,
      isAdmin: false,
    },
    fieldVisibility: {},
    sourceVisibility: {},
    version: 1,
  },
];

// ── Seeded permission policies ───────────────────────────────────────────────
// Policies are evaluated with deny-over-allow. `subjectType`/`subjectId` may be
// 'profile' (apply to everyone holding a profile) or 'employee' (specific person).
export const SEED_POLICIES = [
  {
    policyId: 'pol_compensation_deny_non_privileged',
    subjectType: 'profile',
    subjectId: null, // null = applies to all non-privileged profiles (handled in engine)
    resourceType: RESOURCE_TYPES.FIELD,
    resourceName: 'compensation',
    effect: POLICY_EFFECTS.DENY,
    priority: 100,
    version: 1,
    note: 'Compensation/salary/bonus fields are denied to non-privileged profiles.',
  },
  {
    policyId: 'pol_sensitive_fields_redact_manager',
    subjectType: 'profile',
    subjectId: ACCESS_PROFILE_CODES.TEAM_MANAGER,
    resourceType: RESOURCE_TYPES.FIELD,
    resourceName: 'Employee_Profile.mainWeakness',
    effect: POLICY_EFFECTS.REDACT,
    priority: 50,
    version: 1,
    note: 'Manager sees team but sensitive Employee_Profile fields are redacted.',
  },
];



// ── Validation ───────────────────────────────────────────────────────────────
export function isValidProfileCode(code) {
  return Object.values(ACCESS_PROFILE_CODES).includes(code);
}

export function isValidScope(scope) {
  return Object.values(SCOPE_VALUES).includes(scope);
}

export function isValidEffect(effect) {
  return Object.values(POLICY_EFFECTS).includes(effect);
}

export function isValidResourceType(type) {
  return Object.values(RESOURCE_TYPES).includes(type);
}

// Validate an access profile object shape (returns array of error strings).
export function validateProfile(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['profile must be an object'];
  if (!p.profileCode || !isValidProfileCode(p.profileCode)) errs.push('invalid profileCode');
  if (!isValidScope(p.defaultScope)) errs.push('invalid defaultScope');
  if (p.permissions && typeof p.permissions !== 'object') errs.push('permissions must be an object');
  return errs;
}

// Validate a permission policy object shape.
export function validatePolicy(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['policy must be an object'];
  if (!isValidEffect(p.effect)) errs.push('invalid effect');
  if (!isValidResourceType(p.resourceType)) errs.push('invalid resourceType');
  if (typeof p.priority !== 'number') errs.push('priority must be a number');
  return errs;
}

// Validate a data source link object shape.
export function validateSourceLink(l) {
  const errs = [];
  if (!l || typeof l !== 'object') return ['link must be an object'];
  if (!l.sourceId) errs.push('sourceId required');
  if (!l.employeeCode) errs.push('employeeCode required');
  return errs;
}

// ── Versioning helpers ───────────────────────────────────────────────────────
// Entities are immutable-on-update: an update produces a NEW version while the
// old version is retained (in the audit/version history) for reproducibility.

export function nextVersion(current) {
  return (Number(current) || 0) + 1;
}

export function nowIso() {
  return new Date().toISOString();
}

// Build a versioned record with effectiveFrom/effectiveTo + version.
export function versioned(record, { version = 1, effectiveFrom = null, effectiveTo = null } = {}) {
  return {
    ...record,
    version,
    effectiveFrom: effectiveFrom || nowIso(),
    effectiveTo: effectiveTo || null,
  };
}

// True if a versioned record is currently active (effectiveFrom <= now < effectiveTo).
export function isActiveAt(record, at = new Date()) {
  const t = at instanceof Date ? at : new Date(at);
  const from = record?.effectiveFrom ? new Date(record.effectiveFrom) : null;
  const to = record?.effectiveTo ? new Date(record.effectiveTo) : null;
  if (from && t < from) return false;
  if (to && t >= to) return false;
  return true;
}
