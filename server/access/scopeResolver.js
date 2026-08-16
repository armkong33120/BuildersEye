// scopeResolver.js — Canonical scope resolver.
//
// This is the SINGLE source of truth for "which employees can this viewer see?"
// It replaces the three divergent implementations that previously disagreed:
//   - policy.js:48 resolveScope            (subtreePks/directReportPks)
//   - registryIngest.js:82 buildScopeCodes  (walks managerCode)
//   - chatController.js:498 buildScopeCodesForRole (subtreePks/directReportPks)
//
// Features (per docs/domain-model-design.md §7):
//   - arbitrary depth (BFS over a directed manager→report graph)
//   - multiple C-Level roots (any employee with no active manager)
//   - moving employees / changing managers (temporal relationships, latest wins)
//   - deactivation (status !== 'active' excluded)
//   - cycle detection (visited set — a cycle never causes infinite loop)
//
// Deny-by-default: unknown viewer or unknown profile resolves to SELF/NONE,
// never to ALL.

import { ACCESS_PROFILE_CODES, SCOPE_VALUES, employeeKey } from './accessModel.js';

// ── Org snapshot ─────────────────────────────────────────────────────────────
// Normalize employees + optional temporal relationships into a fast lookup
// structure. Accepts either the registry shape (employeeRegistry.js) or the
// identity-graph shape (build-graph.js).

export function buildOrgSnapshot(employees = [], relationships = []) {
  const byCode = new Map();
  const active = new Map();
  for (const e of employees) {
    if (!e) continue;
    const code = employeeKey(e.code ?? e.employeeCode);
    if (!code) continue;
    const status = String(e.status ?? e.employmentStatus ?? 'active').toLowerCase();
    const isActive = status !== 'removed' && status !== 'inactive' && status !== 'terminated' && status !== 'deactivated';
    byCode.set(code, { ...e, code, isActive });
    if (isActive) active.set(code, e);
  }

  // Temporal relationships: if provided, the latest active edge wins.
  // relationship: { employeeCode, managerCode, relationshipType, effectiveFrom, effectiveTo }
  // A NULL managerCode edge is an EXPLICIT root assignment — it overrides a stale
  // employee.managerCode (so "move to root" via adminService.setManager(_, null)
  // actually takes effect) and preserves multi-root orgs.
  const managerOf = new Map(); // employeeCode -> managerCode (null = root)
  for (const r of relationships || []) {
    const child = employeeKey(r.employeeCode ?? r.childCode);
    const mgr = employeeKey(r.managerCode ?? r.parentCode);
    if (!child) continue;
    managerOf.set(child, mgr || null);
  }

  // Fall back to employee.managerCode for any employee without an explicit edge.
  for (const e of employees) {
    if (!e) continue;
    const code = employeeKey(e.code ?? e.employeeCode);
    if (!code || managerOf.has(code)) continue;
    const mgr = employeeKey(e.managerCode);
    if (mgr) managerOf.set(code, mgr);
  }

  // childrenOf: managerCode -> [childCode] (active employees only)
  const childrenOf = new Map();
  for (const [child, mgr] of managerOf.entries()) {
    if (!active.has(child)) continue; // deactivated employees are not visible
    if (!childrenOf.has(mgr)) childrenOf.set(mgr, []);
    childrenOf.get(mgr).push(child);
  }

  // roots: active employees with no (active) manager
  const roots = [];
  for (const code of active.keys()) {
    const mgr = managerOf.get(code);
    if (!mgr || !active.has(mgr)) roots.push(code);
  }

  return { byCode, active, managerOf, childrenOf, roots };
}


// ── Descendant walk (BFS with cycle detection) ───────────────────────────────
// Returns the set of codes reachable from `startCode` following manager→report
// edges, including `startCode` itself. A cycle is broken by the visited set.
export function collectSubtree(startCode, snapshot) {
  const start = employeeKey(startCode);
  const visible = new Set();
  if (!start || !snapshot.active.has(start)) return visible;
  visible.add(start);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const child of snapshot.childrenOf.get(cur) || []) {
      if (visible.has(child)) continue; // cycle guard
      visible.add(child);
      queue.push(child);
    }
  }
  return visible;
}

// ── Scope resolution ──────────────────────────────────────────────────────────
// Resolve the set of visible employee codes for a viewer + profile.
// Returns { scope, scopeCodes } where scopeCodes is null for ALL, a Set for
// SUBTREE/SELF, and an empty Set for NONE.
export function resolveScopeCodes(profileCode, viewerCode, snapshot) {
  const code = employeeKey(viewerCode);
  switch (profileCode) {
    case ACCESS_PROFILE_CODES.GLOBAL_ADMIN:
    case ACCESS_PROFILE_CODES.HR_PRIVILEGED:
      return { scope: SCOPE_VALUES.ALL, scopeCodes: null };
    case ACCESS_PROFILE_CODES.TEAM_MANAGER:
      return { scope: SCOPE_VALUES.SUBTREE, scopeCodes: collectSubtree(code, snapshot) };
    case ACCESS_PROFILE_CODES.SELF_ONLY:
      return {
        scope: SCOPE_VALUES.SELF,
        scopeCodes: snapshot.active.has(code) ? new Set([code]) : new Set(),
      };
    default:
      // Deny-by-default: unknown profile → NONE.
      return { scope: SCOPE_VALUES.NONE, scopeCodes: new Set() };
  }
}

// ── Full access resolution ───────────────────────────────────────────────────
// Combines profile lookup + scope resolution + a deny-by-default guard.
// `viewer` may be { employeeCode, employeeId, profileCode, accessProfile }.
// `profiles` is a Map<profileCode, profile> (from accessStore).
export function resolveAccess(viewer, snapshot, profiles) {
  const profileCode = viewer?.profileCode
    || viewer?.accessProfile?.profileCode
    || ACCESS_PROFILE_CODES.SELF_ONLY;
  const profile = profiles?.get?.(profileCode) || null;
  const viewerCode = employeeKey(viewer?.employeeCode ?? viewer?.code);
  const { scope, scopeCodes } = resolveScopeCodes(profileCode, viewerCode, snapshot);
  return {
    accessProfile: profile,
    profileCode,
    scope,
    scopeCodes,
    viewerCode,
    allowed: scope !== SCOPE_VALUES.NONE,
  };
}

// ── Legacy compatibility shim ────────────────────────────────────────────────
// Mirrors the old resolveScope(viewerRole, viewerPk, targetPk, identityGraph)
// boolean contract so existing callers can swap in without a behavior break.
export function legacyResolveScope(viewerRole, viewerPk, targetPk, identityGraph) {
  const employees = (identityGraph?.identities || []).map((i) => ({
    code: i.code,
    pk: i.pk,
    managerCode: i.managerCode,
    status: 'active',
  }));
  const snapshot = buildOrgSnapshot(employees);
  const viewer = employees.find((e) => e.pk === Number(viewerPk));
  if (!viewer) return false;
  const profileCode = {
    CEO: ACCESS_PROFILE_CODES.GLOBAL_ADMIN,
    HR: ACCESS_PROFILE_CODES.HR_PRIVILEGED,
    Manager: ACCESS_PROFILE_CODES.TEAM_MANAGER,
    Employee: ACCESS_PROFILE_CODES.SELF_ONLY,
  }[viewerRole] || ACCESS_PROFILE_CODES.SELF_ONLY;
  const { scopeCodes } = resolveScopeCodes(profileCode, viewer.code, snapshot);
  if (scopeCodes === null) return true; // ALL
  const target = employees.find((e) => e.pk === Number(targetPk));
  return target ? scopeCodes.has(target.code) : false;
}
