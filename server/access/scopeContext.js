// scopeContext.js — High-level authorized-scope resolution for the RAG pipeline.
//
// This bridges the legacy `viewer` shape ({ role, employeeId }) produced by
// resolveViewer in index.js and the canonical scope resolver in scopeResolver.js.
// It resolves the viewer's access profile (admin-assigned accessProfile wins,
// else legacy-role-derived) and computes the authorized scopeCodes in ONE place,
// so ingestion/indexing/retrieval/SQL/vector/cache all share the same boundary.
//
// Deny-by-default: unknown viewer / unknown profile → SELF_ONLY / NONE, never ALL.
//
// The canonical resolver replaces the three divergent implementations:
//   - policy.js:48 resolveScope
//   - registryIngest.js:82 buildScopeCodes
//   - chatController.js:498 buildScopeCodesForRole

import { buildOrgSnapshot, resolveAccess } from './scopeResolver.js';
import { profileCodeForViewer } from './compatAdapter.js';
import { getProfilesMap, getEmployees, getRelationships } from './accessStore.js';
import { employeeKey } from './accessModel.js';

// Resolve the authorized scope for a legacy viewer.
//
// opts (all optional; sensible defaults read from accessStore):
//   employees       — org snapshot source (registry active employees recommended:
//                     current Excel/OneDrive truth, with code/pk/managerCode/status)
//   relationships   — admin temporal edges (accessStore relationships)
//   profiles        — Map<profileCode, profile> (accessStore profiles)
//   profileByCode   — Map<employeeCode, accessProfile> (admin-assigned profiles)
//
// Returns the full resolveAccess result:
//   { accessProfile, profileCode, scope, scopeCodes, viewerCode, allowed }
//   scopeCodes: null = ALL, Set<code> = SUBTREE/SELF, empty Set = NONE.
export function resolveViewerScope(viewer, opts = {}) {
  const employees = opts.employees || getEmployees();
  const relationships = opts.relationships || getRelationships();
  const profiles = opts.profiles || getProfilesMap();
  const profileByCode = opts.profileByCode
    || new Map(getEmployees().map((e) => [employeeKey(e.employeeCode), e.accessProfile]));

  const snapshot = buildOrgSnapshot(employees, relationships);

  // Resolve viewer identity → stable employeeCode (from explicit code, else
  // legacy numeric employeeId/pk).
  let viewerCode = employeeKey(viewer?.employeeCode ?? viewer?.code);
  if (!viewerCode && viewer?.employeeId != null) {
    const emp = employees.find((e) => Number(e.employeeId ?? e.pk) === Number(viewer.employeeId));
    viewerCode = emp ? employeeKey(emp.code ?? emp.employeeCode) : null;
  }

  // Resolve profile: explicit profileCode wins, then admin-assigned accessProfile
  // for the viewer, then the legacy role mapping. Unknown → SELF_ONLY.
  let profileCode = viewer?.profileCode || viewer?.accessProfile?.profileCode;
  if (!profileCode) {
    profileCode = profileByCode.get(viewerCode) || profileCodeForViewer(viewer);
  }

  return resolveAccess({ employeeCode: viewerCode, profileCode }, snapshot, profiles);
}
