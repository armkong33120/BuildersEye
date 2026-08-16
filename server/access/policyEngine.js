// policyEngine.js — Policy evaluation with allow/deny/redact.
//
// Replaces the hardcoded SENSITIVE_FIELDS map and the 3x duplicated
// confidentiality map with policy-driven redaction.
//
// Evaluation model:
//   - Policies are matched against (subject, resource).
//   - Effects: allow | deny | redact.
//   - Deny-over-allow: any matching DENY beats an ALLOW, regardless of priority.
//   - Priority orders REDACT vs ALLOW (higher priority wins) but never overrides DENY.
//   - Deny-by-default: no matching ALLOW → deny.
//
// The LLM NEVER decides permissions — this engine is the only authority.

import { POLICY_EFFECTS, RESOURCE_TYPES } from './accessModel.js';

// Normalize a resource name for matching.
function normalizeResourceName(name) {
  const s = String(name ?? '').trim();
  if (!s) return '';
  return s.toLowerCase();
}

// Does a policy's resourceName match the requested resource?
function resourceMatches(policy, resource) {
  const target = normalizeResourceName(policy.resourceName);
  if (!target) return false;
  const sheet = normalizeResourceName(resource.sheet);
  const field = normalizeResourceName(resource.field);
  const source = normalizeResourceName(resource.source);

  if (policy.resourceType === RESOURCE_TYPES.SHEET) {
    return sheet === target || sheet.includes(target);
  }
  if (policy.resourceType === RESOURCE_TYPES.SOURCE) {
    return source === target || source.includes(target);
  }
  if (policy.resourceType === RESOURCE_TYPES.FIELD) {
    if (sheet && field && `${sheet}.${field}` === target) return true;
    if (field && (field === target || field.includes(target))) return true;
    if (field && target && (field.includes(target) || target.includes(field))) return true;
    if (sheet && target && sheet.includes(target)) return true;
    return false;
  }
  return false;
}

// Does a policy apply to this subject?
function subjectMatches(policy, subject) {
  if (policy.subjectType === 'employee') {
    return policy.subjectId === subject.employeeCode;
  }
  if (policy.subjectId == null) return true; // applies to all profiles
  return policy.subjectId === subject.profileCode;
}

// Find policies that match a (subject, resource) pair (no deny-by-default here).
export function findMatchingPolicies(subject, resource, policies = []) {
  const matches = [];
  for (const p of policies) {
    if (!subjectMatches(p, subject)) continue;
    if (!resourceMatches(p, resource)) continue;
    matches.push(p);
  }
  return matches;
}

// Evaluate policies for a (subject, resource) pair.
// Deny-over-allow: any matching DENY beats an ALLOW regardless of priority.
// Deny-by-default: no matching ALLOW → deny (for access decisions).
export function evaluatePolicies(subject, resource, policies = []) {
  const matches = findMatchingPolicies(subject, resource, policies);

  if (matches.length === 0) {
    return { effect: POLICY_EFFECTS.DENY, matchedPolicyIds: [] };
  }

  const denies = matches.filter((p) => p.effect === POLICY_EFFECTS.DENY);
  if (denies.length > 0) {
    const top = denies.sort((a, b) => b.priority - a.priority)[0];
    return { effect: POLICY_EFFECTS.DENY, matchedPolicyIds: [top.policyId] };
  }

  const sorted = matches.slice().sort((a, b) => b.priority - a.priority);
  const top = sorted[0];
  return { effect: top.effect, matchedPolicyIds: [top.policyId] };
}

// ── Field redaction ──────────────────────────────────────────────────────────
export function applyFieldRedactionPolicy(record, access, policies = []) {
  if (!record || typeof record !== 'object') return record;
  const profileCode = access?.profileCode;
  const profile = access?.accessProfile || {};

  const fieldVisibility = profile.fieldVisibility || {};
  const sheet = record.sheetName;
  const field = record.fieldName;
  const hiddenFields = (sheet && fieldVisibility[sheet]) || [];

  const subject = { profileCode, employeeCode: access?.viewerCode };
  // Field redaction only applies on an EXPLICIT deny/redact match (or a
  // fieldVisibility hide). A field with no matching policy is left untouched —
  // deny-by-default governs whole-resource access, not per-field redaction.
  const matches = findMatchingPolicies(subject, { sheet, field, source: record.source }, policies);
  const hasDeny = matches.some((p) => p.effect === POLICY_EFFECTS.DENY);
  const hasRedact = matches.some((p) => p.effect === POLICY_EFFECTS.REDACT);

  const isHiddenByVisibility = hiddenFields.includes(field);

  if (hasDeny || hasRedact || isHiddenByVisibility) {
    return { ...record, content: '[Redacted — Policy]', redacted: true };
  }
  return record;
}

// ── Compensation detection (legacy parity) ───────────────────────────────────
const COMPENSATION_TERMS = /salary|compensation|bonus|incentive|ค่าจ้าง|เงินเดือน|โบนัส|ค่าตอบแทน/i;

export function isCompensationField(fieldName, sheetName) {
  const f = String(fieldName || '');
  const s = String(sheetName || '');
  return COMPENSATION_TERMS.test(f) || COMPENSATION_TERMS.test(s);
}

export function canSeeCompensation(access) {
  return !!access?.accessProfile?.permissions?.canSeeCompensation;
}
