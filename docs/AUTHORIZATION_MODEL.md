# Authorization Model — BuildersEye

Status flags used throughout: **[VERIFIED IN CODE]** · **[INFERRED FROM BEHAVIOR]** · **[PROPOSED FUTURE STATE]** · **[NOT YET IMPLEMENTED]**

## Summary

Authorization is a stack evaluated server-side, never on the client, and never decided by the LLM:

`JWT identity → authenticated user → accessProfile → org scope → source scope → sheet scope → field scope → redaction → retrieval → LLM context`

## Roles vs Access Profiles
- **Job titles are display metadata and are never authz rules.** They are mapped to an `accessProfile` at migration time only.
- Migrated profiles: `CEO→GLOBAL_ADMIN`, `HR→HR_PRIVILEGED`, `Manager→TEAM_MANAGER`, `Employee→SELF_ONLY`. **[VERIFIED IN CODE — accessModel.js seed]**
- A COO may or may not hold `GLOBAL_ADMIN` depending on policy — the profile is the authority, not the title.

## Policy engine
- `policyEngine.js` evaluates `allow | deny | redact` with semantics priority + **deny-over-allow**. **[VERIFIED IN CODE]**
- Deny-by-default: no matching ALLOW → deny. **[VERIFIED IN CODE]**
- Field/sheet/source redaction is policy-driven, replacing the hardcoded `SENSITIVE_FIELDS` map and the duplicated confidentiality-tier map. **[VERIFIED IN CODE]**

## Scope resolver
- Canonical `scopeResolver.js` (BFS over org edges with cycle detection) replaces three previously divergent scope implementations. **[VERIFIED IN CODE]**
- Vector retrieval receives the authorized scope pre-retrieval. **[VERIFIED IN CODE]**
- SQL runs only against an already-scoped dataset. **[VERIFIED IN CODE via sqlEngine/sqlRouting]**

## Hard rules enforced
- Backend is source of truth; request-body role/employeeId/permissions are never trusted. **[VERIFIED IN CODE — adminRoutes.js requires requireAuth + requireAdmin, spoof test passes]**
- Default-to-CEO fallbacks removed → deny-by-default. **[VERIFIED IN CODE]**
- Cache keys embed the policy version so permission changes invalidate affected caches. **[VERIFIED IN CODE — responseCache.js / accessStore policy_version]**
- Old policy versions are audit-able and restorable via `auditStore.js`. **[VERIFIED IN CODE]**
- Admin config endpoints are authenticated admin-only; read and write config APIs are separated. **[VERIFIED IN CODE]**

## Not yet implemented / proposed
- Neon (Postgres) DDL write-through for the new tables. **[PROPOSED FUTURE STATE]**
- Full decommission of legacy scope shims (`legacyResolveScope`). **[PROPOSED FUTURE STATE]**
- Cross-user conversation scoping (global `conversations`/`latestPipeline`). **[NOT YET IMPLEMENTED]**