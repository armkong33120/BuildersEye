# Changelog — BuildersEye

## [0.2.0] — 2026-08-16 — Organization & Authorization Redesign (core)
Change: `CHG-org-access-redesign` · Branch: `codex/org-access-redesign-20260816`

### Added
- Normalized domain model separating Identity / Organization / Authorization (`server/access/accessModel.js`, `accessStore.js`).
- Canonical org scope resolver with arbitrary depth + cycle detection (`scopeResolver.js`).
- Policy engine with allow/deny/redact + deny-over-allow (`policyEngine.js`).
- Compatibility adapter deriving legacy `viewer.role` from `accessProfile` (`compatAdapter.js`).
- Audit store + admin service + separate read/write admin APIs (`auditStore.js`, `adminService.js`, `adminRoutes.js`).
- Source-link model + duplicate-ownership prevention + protected re-index (`sourceLinks.js`, `rebuildVectors.js`).
- CEO Admin console (`admin.html`) with org tree, sources, permission matrix, preview-as-user, audit.
- Tests: `test_access_model`, `test_admin_service`, `test_admin_api`, `test_source_links`, `test_vector_staleness`, `test_scope_context`, `verify_rag_scope`.

### Changed
- Deny-by-default replaces default-to-CEO fallbacks in `chatController`, `semanticParser`, `responseCache`, `sqlEngine`.
- Vector retrieval receives the authorized scope pre-query (previously post-filter only).
- Cache keys embed the policy version so permission changes invalidate caches.
- Removed fixed `150` / `EMP\d{3}` / 1:1 file↔employee assumptions from runtime logic.
- Fixed HR-by-department bug: now matches `HR & Admin` (real data) in addition to `HR / Admin`.
- Frontend `index.html`/`app.html` not changed except admin entry; `admin.html` added.

### Security
- Backend is source of truth for authz; request-body role/employeeId/permissions not trusted.
- `requireAdmin` consults access-profile `isAdmin`.

### Known limitations / not yet
- Neon DDL write-through for new tables (file-based local store).
- Full decommission of legacy scope shims.
- Cross-user conversation scoping.
- Playwright browser E2E not run (Playwright MCP unavailable in this environment; auth not configured).