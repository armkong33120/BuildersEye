# Service Catalog — BuildersEye

Status flags: **[VERIFIED IN CODE]** · **[INFERRED FROM BEHAVIOR]** · **[PROPOSED FUTURE STATE]** · **[NOT YET IMPLEMENTED]**

| Service / component | Owner | Purpose | Status |
|---|---|---|---|
| `server/index.js` (Express app) | App | HTTP server; mounts auth, chat, registry, admin, debug routes | **[VERIFIED IN CODE]** |
| `server/authStore.js` | AuthN | JWT issue/verify, user store, legacy role derivation | **[VERIFIED IN CODE]** |
| `server/access/accessModel.js` | Domain | Normalized Employee/Org/SourceLink/Permission/Profile entities | **[VERIFIED IN CODE]** |
| `server/access/accessStore.js` | Domain | File-backed persistence + seeding + policy version | **[VERIFIED IN CODE]** |
| `server/access/scopeResolver.js` | AuthZ | Canonical org scope resolver (BFS + cycle detection) | **[VERIFIED IN CODE]** |
| `server/access/policyEngine.js` | AuthZ | allow/deny/redact policy evaluation | **[VERIFIED IN CODE]** |
| `server/access/compatAdapter.js` | AuthZ | legacy `viewer.role` derived from accessProfile | **[VERIFIED IN CODE]** |
| `server/access/auditStore.js` | Ops | Immutable audit events + version history | **[VERIFIED IN CODE]** |
| `server/access/adminService.js` | Admin | Write-separated config ops + rollback | **[VERIFIED IN CODE]** |
| `server/adminRoutes.js` | Admin | `/api/admin/*` read/write endpoints (requireAuth + requireAdmin) | **[VERIFIED IN CODE]** |
| `server/ingestExcel.js`, `registryIngest.js`, `onedriveSync.js` | Data | Source ingestion honoring source-links | **[VERIFIED IN CODE]** |
| `server/searchIndex.js`, `vectorStore.js`, `hybridSearch.js` | RAG | Indexing + retrieval, scope-aware | **[VERIFIED IN CODE]** |
| `server/sqlEngine.js`, `sqlRouting.js` | RAG | Scoped SQL execution | **[VERIFIED IN CODE]** |
| `server/responseCache.js` | RAG | Versioned cache keys | **[VERIFIED IN CODE]** |
| `admin.html` (Vite) | UI | CEO Admin console (org tree, sources, permissions, preview, audit) | **[INFERRED FROM BEHAVIOR]** (build OK; not browser-verified) |
| `server/neonStore.js`, `neonSync.js` | Data | Optional Neon Postgres persistence | **[PROPOSED FUTURE STATE]** for new tables |