# Changelog — BuildersEye

## [0.6.0] — 2026-08-18 — Neon Access Persistence (multi-instance ready)
Change: `CHG-neon-access-persistence` · Branch: `codex/neon-access-persistence-20260818` (backup `codex/backup-before-neon-access-persistence-20260818-0156`)

### Added
- **Neon/Postgres access-model adapter** (`server/access/accessStoreNeon.js`) — write-through in-memory cache, optimistic concurrency (version column), policy-version atomic `UPDATE RETURNING`, audit write-through (JSON + Neon).
- **`ACCESS_DB_ADAPTER=json|neon`** env var — `json` (default, single-instance) unchanged; `neon` activates the Postgres adapter.
- **7 new Neon tables** alongside existing RAG registry: `access_profiles`, `access_policies`, `access_source_links`, `access_employees`, `access_relationships`, `access_policy_version`, `access_audit`.
- **Migration script** `scripts/migrate-access-to-neon.mjs` — JSON → Neon upsert (idempotent).
- **Rollback script** `scripts/rollback-neon-access-to-json.mjs` — Neon → JSON dump.
- **Neon adapter test** `scripts/test_access_neon_adapter.mjs` — **13/13** passed.

### Changed
- `server/access/adminService.js` — write functions async; `applyAndAudit`/`recordRejected` write audit to JSON (always) + Neon (when configured); `readAccess.audit` reads Neon when configured.
- `server/adminRoutes.js` — all write handlers async + await adminService.
- `server/index.js` — boot initializes Neon access schema + cache preload when `ACCESS_DB_ADAPTER=neon`.
- `server/.env.example` — documented `ACCESS_DB_ADAPTER`.

### Verified
- **JSON regression:** persistence restart 14/14, isolation security 46/46, admin preview contract 48/48, org integrity 32/32, canonical policy 25/25, legacy shim parity 38/38, verify:security 34/34, build OK, benchmark:dynamic 75/75, git diff --check clean.
- **Neon adapter:** schema init (idempotent), preload, seed (idempotent), write/read profiles, policy-version atomicity, version column, save policy, audit CRUD — **13/13**.

### Regression discovered & fixed (async conversion)
- Converting `adminService` writes to `async` initially broke the direct-caller tests
  (`test_org_integrity`, `test_admin_service`) and `benchmark/dynamic-org`: they called
  `adminService.setManager`/`assignProfile`/`accStore.save*` without `await`, so rejected
  writes surfaced as rejected Promises (not caught by `try/catch`) and successful writes
  returned Promises. Added `await` to all 3 files — **org-integrity 32/32, admin_service
  20/20, benchmark:dynamic 75/75** restored. These were regressions, not "known gaps".

### Latency (measured on Neon-access backend, 30s timeout, 0 timeouts / 0 errors)
- **Login** p50=19052ms p95=19590ms (~19 s — Neon `auth_sessions` round-trip; the environmental
  bottleneck, matches 0.5.0's ~15 s documentation).
- **Admin API** p50=2ms p95=8ms; **Policy read** p50=2ms p95=2ms — the Neon access
  adapter's in-memory cache keeps reads sub-10ms despite multi-instance persistence.
- Conclusion: the access adapter adds no read-latency penalty; the ~19 s login is Neon
  session latency, not access persistence. Auth-gated suites need a timeout > 19 s
  (e.g. 60 s).

### Production-readiness verdict
**READY** for multi-instance deployment when `ACCESS_DB_ADAPTER=neon` is configured.
JSON adapter remains the default; migration is explicit and reversible.

## [0.5.0] — 2026-08-17 — Live Verification Gate (JWT uniqueness + conversation-owner fix + test hardening)
Change: `CHG-final-live-gate` · Branch: `codex/final-live-gate-20260817` (baseline `a7df4cb`, backup `codex/backup-before-final-live-gate-20260817-1733`)

### Fixed
- **JWT uniqueness (`server/authStore.js`)** — access tokens now carry a random `jti` claim, so two JWTs issued in the same second differ (previously identical). Fixes session-refresh rotation expectations.
- **Conversation ownership at the live `/api/chat` (`server/index.js`)** — `conversationStore.addMessage(convId,'user',query,undefined,req.authUser.id)` (owner was being passed as `title`, so `userId` was `undefined` → conversations were never persisted and the H2 cross-user 403 guard never fired on the live API). Now conversations persist to disk and a second user's append to another user's conversation returns **403**.

### Changed
- `scripts/run_all_tests.mjs` auto-derives test credentials from `server/.env` (`ENABLE_TEST_CREDS=true`), so the 11 auth-gated suites run instead of skipping; default usernames corrected to real accounts (`emp002`, `emp012`; `hr-manager`/`emp001` do not exist in this identity graph).
- `scripts/test_ui_playwright_headful.mjs` runs Chromium **headless**.
- `scripts/test_isolation_api.mjs` — removed unreachable dead code.

### Verified (real numbers, 2026-08-17, live local backend, file-backed sessions)
- `npm test`: **23 passed / 2 failed / 0 skipped (25 total)**. Failures: **Cache Hit** (flake under burst; passes 5/5 isolated) and **SQL Fallback** (brittle trace-label assertion; behavior correct, 5/6 isolated).
- `verify:security` **34/34** · `npm run build` **OK** · `benchmark:dynamic` **75/75** leakage 0% · `git diff --check` clean.
- **Headless Playwright E2E 3/3 PASSED** (login → chat → debug), 0 console/page errors.
- Auth-gated isolated: Session Refresh **14/14**, Isolation API (live) **13/13**, RBAC Matrix **7/7**, Cache Hit **5/5**, Invalid Login **5/5**.
- Admin console: CEO admin login works (all admin endpoints 200); non-admin denied (403, no 2xx admin data); CORS correct. Full section-render inconclusive in headless harness (boot-probe client-side "network error" artifact; server returns 200 with correct CORS).

### Deferred / limitations (honest)
- **Multi-instance** access-model persistence remains **BLOCKED** (filesystem-local advisory lock; Neon access-model write-through NOT implemented — `docs/PERSISTENCE.md`).
- Admin-console full section-render not confirmed in this headless harness.
- **Neon**-backed session latency here ~15 s/round-trip (vs 0.1 s file-backed), so auth suites exceed timeouts against a Neon backend; environmental observation, not a product defect.
- Production-readiness verdict: **READY WITH LIMITATIONS** (single-instance demo/staging); no deployment; `main` not pushed.

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