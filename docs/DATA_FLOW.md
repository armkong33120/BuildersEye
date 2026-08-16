# Data Flow — BuildersEye

Status flags: **[VERIFIED IN CODE]** · **[INFERRED FROM BEHAVIOR]** · **[PROPOSED FUTURE STATE]** · **[NOT YET IMPLEMENTED]**

## Authorization-time data flow (reads)
```
Client request
  → JWT (authStore) → req.viewer
  → accessProfile (compatAdapter, derived)
  → org scope (scopeResolver)
  → source/sheet/field scope (policyEngine allow/deny/redact)
  → SQL: query only the already-scoped table [VERIFIED]
  → Vector: retrieve with authorized scope PRE-query [VERIFIED]
  → evidence built WITHOUT unauthorized records [VERIFIED]
  → LLM context (post-scope), LLM never decides permissions [VERIFIED]
  → response cache keyed by identity+policy version [VERIFIED]
```

## Source-link → index data flow
```
CEO admin configures source-link (adminRoutes/adminService)
  → audit event (auditStore)
  → ingestion (ingestExcel/registryIngest/onedriveSync) honors enabled+ownership
  → chunks indexed with employeeCode/scope metadata (searchIndex/vectorStore)
  → org change triggers re-index + stale-index detection (rebuildVectors)
  → policy version bump invalidates affected caches
```

## Key invariants
- SQL cannot escape its scoped table. **[VERIFIED IN CODE — sqlRouting non-SELECT block + scope filter]**
- Retrieval evidence never shows unauthorized records; deny-by-default closes empty-set leak paths. **[VERIFIED IN CODE — rag commit 18933ad]**
- Stale index is exposed via registry `vectors.stale` (boolean). **[VERIFIED IN CODE — registry/status]**

## Not yet implemented
- Neon write-through of new tables. **[PROPOSED FUTURE STATE]**
- Cross-user conversation scoping. **[NOT YET IMPLEMENTED]**