# Changelog — BuildersEye

## [0.4.0] — 2026-08-16 — Final Hardening (write-path org integrity + canonical authorization + persistence P2 + preview contract)
Change: `CHG-production-hardening-final` · Branch: `codex/final-hardening-20260816` (baseline `54a1038`, backup `codex/backup-before-final-hardening-20260816-2121`)

### Added
- Write-path org integrity (`server/access/orgIntegrity.js`): every employee/relationship write validates the WHOLE org before persisting. Duplicate employeeCode → `409`, self-manager → `400`, hierarchy cycles (A→B→A, A→B→C→A) → `409`, missing non-null manager → `400`; valid single-root and multi-root orgs preserved; rejected writes are audited (`action:'rejected'`, safe category detail) and leave the store byte-identical (no partial write). `buildOrgSnapshot` honors explicit root relationships (move-to-root actually takes effect).
- Canonical authorization bridge (Phase 3): `canonicalQueryPolicy` + `applyFieldRedactionPolicy` threaded into chat; legacy `policy.js` reduced to a delegating deprecated shim; legacy-shim parity suite now proves query-policy parity and zero redaction divergences.
- Hardening fixes: M1 profile-authoritative admin check (legacy fallback only pre-seed), L2 `conversationId` length cap/hash, L4 webhook `clientState` must be present and equal.
- Persistence P2: atomic JSON writes (temp file + `fs.renameSync`) + advisory write lock (`withAccessWriteLock`, ~5s timeout, stale-lock break) across all access-store mutation helpers; audit line-atomicity documented.
- Static `/api/admin/preview` contract regression suite (48 asserts, no credentials/browser needed) + canonical policy suite (25) + org-integrity suite (32).
- Benchmark write-path org-integrity section: duplicate-code/cycle/self-manager/missing-manager rejections, valid single/multi-root, valid move persists, rejected writes leave store unchanged.

### Changed (behavior)
- Admin writes that would create duplicate employee codes or cyclic/missing-manager hierarchies are now REJECTED (previously the resolver collapsed duplicates last-wins and broke cycles silently). Read path stays crash-safe on legacy bad data.
- `adminService.setManager(actor, employeeCode, null)` now records an explicit root relationship (move-to-root actually takes effect; multi-root preserved).

### Verified (real numbers, 2026-08-16)
- `npm test`: **14 passed / 0 failed / 11 skipped** with a live local backend (all 11 skipped are auth-gated — require `TEST_USERNAME`/`TEST_PASSWORD`; Invalid Login ran live 5/5). Without a live backend, Invalid Login is also skipped: 13 passed / 12 skipped.
- `verify:security`: **34/34**. `npm run build`: **OK**.
- `benchmark:dynamic`: **75/75** (58 original + 17 write-path org-integrity), leakage **0%**, all metrics 100%.
- `test_org_integrity` 32/32 · `test_canonical_policy` 25/25 · `test_legacy_shim_parity` 38/38 · `test_isolation_security` 46/46 · `test_persistence_restart` 14/14 · `test_admin_preview_contract` 48/48 · live backend invalid-login 5/5.

### Deferred / NOT RUN (honest)
- Browser E2E (Playwright) NOT run — no MCP + no `TEST_ACCOUNT_PASSWORD`; auth-gated live suites NOT run (no `TEST_USERNAME`/`TEST_PASSWORD`). **Production-readiness verdict: READY WITH LIMITATIONS.**
- Multi-instance access-model persistence remains **BLOCKED** (filesystem-local advisory lock; Neon write-through for the access model NOT implemented — see `docs/PERSISTENCE.md`).

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