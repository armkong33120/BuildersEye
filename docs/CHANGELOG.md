# Changelog — BuildersEye

## [0.3.0] — 2026-08-16 — Production Hardening (isolation + preview + benchmark + persistence review)
Change: `CHG-production-hardening` · Branch: `codex/production-hardening-20260816` (baseline `07d613a`, backup `codex/backup-before-production-hardening-20260816-1208`)

### Added
- Cross-user isolation: conversation ownership (`conversationStore` owner + 403/404 enforcement), per-user `latestPipeline` with policy-version staleness guard, chat-memory partition (`userId:conversationId`).
- Admin `POST /api/admin/preview` — evaluates the SELECTED user's profile+scope via the canonical engine, ignores body identity/profileCode, returns status-only records, marks preview mode, audits.
- Policy engine permission-awareness: privileged profiles are never denied by the seeded null-subject compensation policy; `evaluatePolicies` grants implicit ALLOW via `canSeeCompensation`/`canSeeSensitive`; tightened FIELD resource matching (removed cross-sheet substring over-match).
- Dynamic organization benchmark `benchmark/dynamic-org.mjs` (`npm run benchmark:dynamic`) — 58/58, leakage 0%.
- Restart-persistence test (`test_persistence_restart.mjs`) + legacy shim parity test (`test_legacy_shim_parity.mjs`).
- `docs/PERSISTENCE.md` (adapter boundary + multi-instance limitation) and hardening event catalogue in `docs/EVENT_MANAGEMENT.md`.

### Fixed
- `/api/debug/online` and `/api/registry/status` no longer leak user/OneDrive-account metadata to non-admins.
- Admin Preview As User no longer advertises a missing backend endpoint; UI clears stale preview state and shows PREVIEW MODE + policyVersion.
- Registry-detail and semantic-search sensitive-redaction decisions derive from the access profile (not the legacy role string).
- `run_all_tests.mjs` probes backend health so HTTP-only suites skip (not fail) without a live server.

### Changed (behavior)
- Conversations are owner-scoped: `GET/DELETE /api/conversations/:id` return 404 for another user's conversation; chat with a foreign `conversationId` returns 403.
- Debug pipeline is per-user and dropped when the policy version changed.

### Deferred / documented
- Chat redaction still uses the legacy `policy.js` shim (2 documented divergences; migration deferred until live E2E).
- Neon write-through for the access model NOT implemented — multi-instance access persistence BLOCKED.
- Browser E2E (Playwright) NOT run (MCP unavailable + no `TEST_ACCOUNT_PASSWORD`).

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