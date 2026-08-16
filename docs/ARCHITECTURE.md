# BuildersEye — Architecture

Status flags: **[VERIFIED IN CODE]** · **[INFERRED FROM BEHAVIOR]** · **[PROPOSED FUTURE STATE]** · **[NOT YET IMPLEMENTED]**

## Layered view
```
Frontend (Vite)          app.html · admin.html (CEO console) · debug_neural_network_diagram.html
      │  REST + JWT
Backend (Express)        server/index.js
      │
      ├── AuthN:      authStore.js
      ├── AuthZ:      server/access/{scopeResolver,policyEngine,compatAdapter}   [NEW]
      ├── Admin:      adminRoutes.js + access/{adminService,auditStore}          [NEW]
      ├── Domain:     access/accessModel.js + accessStore.js                     [NEW]
      ├── Data/RAG:   ingestExcel, registryIngest, onedriveSync,
      │               searchIndex, vectorStore, hybridSearch, sqlEngine, sqlRouting,
      │               chatController, semanticParser, responseCache
      └── Persist:    JSON under server/.data/ (local) · Neon (optional)
```

## Key design decision
The redesign keeps the existing JWT/`viewer.role` surface intact (backward compatible) while introducing a normalized domain model underneath. `viewer.role` is now **derived** from `accessProfile`, not stored. **[VERIFIED IN CODE — compatAdapter.js]**

## Retrieval path
Scope is resolved once (`scopeResolver`) and threaded into both SQL and vector retrieval pre-query; evidence is built after scoping. **[VERIFIED IN CODE]**

## Admin console
`admin.html` is built from the admin entry (Vite) and consumes `/api/admin/*`. It provides org tree, data-source links, permission matrix, preview-as-user, and audit history. **[INFERRED FROM BEHAVIOR]** (build succeeds; not browser-verified). Playwright MCP not available; API tests for admin pass. **[VERIFIED IN CODE — test_admin_api 9/9]**

## Deferred
- Neon write-through, legacy scope-shim decommission, cross-user conversation scoping. **[PROPOSED FUTURE STATE]**