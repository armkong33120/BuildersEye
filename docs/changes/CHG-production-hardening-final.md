# CHG-production-hardening-final — BuildersEye Final Hardening (write-path org integrity + canonical authorization + persistence P2 + preview contract)

Status: **Implemented / Verified with limitations** · Branch: `codex/final-hardening-20260816`
Backup branch: `codex/backup-before-final-hardening-20260816-2121`
Baseline commit: `54a1038`
Release version: `0.4.0`

## Change summary

Final-hardening follow-up to `CHG-production-hardening` (0.3.0). Closes the
remaining write-path and policy-bridge gaps:

1. **Write-path org integrity (M2)** — `server/access/orgIntegrity.js` validates
   the WHOLE org (with the proposed change applied) before any employee/relationship
   write persists. Duplicate employeeCode → 409, self-manager → 400, hierarchy
   cycles (A→B→A, A→B→C→A) → 409, missing non-null manager → 400. Rejected writes
   are audited (`action:'rejected'`, safe category detail) and never mutate the
   store (no partial write). `buildOrgSnapshot` honors explicit root relationships
   so move-to-root actually takes effect and multi-root orgs are preserved.
2. **Canonical authorization (Phase 3)** — `canonicalQueryPolicy` +
   `applyFieldRedactionPolicy` threaded into chat; legacy `policy.js` reduced to a
   delegating deprecated shim; parity suite proves query-policy parity and **zero**
   redaction divergences (the two 0.3.0 divergences are resolved).
3. **M1/L2/L4 hardening** — profile-authoritative admin check (legacy fallback only
   pre-seed), `conversationId` length cap/hash, webhook `clientState` must be
   present and equal.
4. **Persistence P2** — atomic JSON writes (temp file + `fs.renameSync`) and an
   advisory write lock (`withAccessWriteLock`) across all access-store mutation
   helpers; audit line-atomicity documented. Single-instance persistence is now
   **SAFE**; multi-instance across hosts remains **BLOCKED**.
5. **Static preview-contract regression** — 48 asserts covering the admin preview
   contract with no credentials or browser needed.

## Change ID / Version
- Change ID: `CHG-production-hardening-final`
- Version: `1.0.0`
- Reason: Duplicate/cyclic/missing-manager writes were previously accepted
  (resolver collapsed/ignored them); chat authz still bridged through a legacy
  shim with 2 documented redaction divergences; JSON writes were not atomic and
  concurrent writers could interleave; the preview contract had no static guard.
- Risk: High (security-sensitive server changes: admin write path, chat authz,
  webhook validation, persistence).

## Files changed (commits on task branch)
Security/org integrity:
- `server/access/orgIntegrity.js` (new) — pure validation functions:
  `assertNoDuplicateEmployeeCodes`, `assertAcyclicManagerGraph`,
  `assertManagerExists`, `assertOrgIntegrity`.
- `server/access/adminService.js` — `assignProfile`/`setManager` validate the whole
  org before save; rejected writes audited (`recordRejected`, safe category
  detail); `setManager(_, null)` records an explicit root relationship.
- `server/access/scopeResolver.js` — explicit root relationships honored by
  `buildOrgSnapshot`; read path stays crash-safe on legacy bad data.
- `server/access/index.js` — barrel export of `orgIntegrity.js`.

Canonical authorization (Phase 3):
- `server/access/policyEngine.js` — `canonicalQueryPolicy`,
  `applyFieldRedactionPolicy` (93 added lines).
- `server/chatController.js`, `server/searchIndex.js`, `server/index.js` —
  canonical query/redaction policy threaded into chat.
- `server/policy.js` — reduced to a delegating deprecated shim.

M1/L2/L4 hardening:
- `server/index.js` — profile-authoritative admin check (legacy fallback only
  pre-seed), `conversationId` length cap/hash.
- `server/onedriveWebhook.js` — webhook `clientState` must be present and equal.
- `server/conversationStore.js` — conversationId hardening support.

Persistence P2:
- `server/access/accessStore.js` — atomic temp-file + `fs.renameSync` writes,
  `withAccessWriteLock` (atomic `mkdir` lockdir, ~5s timeout, stale-lock break via
  mtime, in-process reentrancy guard) around all mutation helpers.
- `server/access/auditStore.js` — line-atomicity documentation.

Tests/benchmark:
- `scripts/test_org_integrity.mjs` (32 cases) — write-path integrity suite.
- `scripts/test_canonical_policy.mjs` (25 cases) — canonical authz bridge.
- `scripts/test_admin_preview_contract.mjs` (48 cases) — static preview contract;
  added to `npm test`.
- `scripts/test_isolation_security.mjs` — extended to 46 (M1/L2/L4 regression).
- `scripts/test_persistence_restart.mjs` — extended to 14 (concurrency + atomicity).
- `scripts/test_legacy_shim_parity.mjs` — extended to 38 (query-policy parity,
  zero redaction divergences).
- `benchmark/dynamic-org.mjs` — extended 58 → 75 with write-path org-integrity
  section (duplicate-code 409, self-manager 400, cycles 409, missing manager 400,
  single/multi-root allowed, valid move persists, rejected write leaves store
  byte-identical).

Docs:
- `docs/CHANGELOG.md`, `docs/SYSTEM_VERSION.md`, `docs/TEST_STRATEGY.md`,
  `docs/EVENT_MANAGEMENT.md`, `docs/OPERATIONS_RUNBOOK.md`, `docs/ROLLBACK_PLAN.md`,
  `docs/PERSISTENCE.md`, `docs/changes/CHG-production-hardening-final.md` (this file).

Commit hashes: `3f7795c`, `27cc3de`, `b9a8760`, `2589a9e`, `5a3601c`, `6cd986c`,
(final docs commit).

## Data-flow impact
- Admin writes that would produce duplicate employee codes, cyclic/missing-manager
  hierarchies are now rejected before any byte is written (no partial writes);
  rejected writes are audited with a safe category string (never employee data).
- Move-to-root via `setManager(_, null)` now persists an explicit root
  relationship instead of being dropped.
- Chat queries now flow through `canonicalQueryPolicy` + `applyFieldRedactionPolicy`;
  `policy.js` delegates to the canonical engine (deprecated shim).
- Access-store JSON writes are atomic (temp + rename) and serialized by an
  advisory lock on the shared data dir (same-host).

## Security impact
- **Write-path enforcement:** duplicate/cyclic/missing-manager writes can no longer
  enter the store; the resolver's read-path leniency is retained only for legacy
  bad data (crash-safe).
- **Canonical authz bridge:** chat and admin preview now share the canonical engine;
  zero legacy-shim redaction divergences remain (parity 38/38).
- **M1:** admin checks are profile-authoritative; legacy-role fallback applies only
  before seeding.
- **L2:** `conversationId` is length-capped and hashed — no unbounded storage/DoS.
- **L4:** webhooks require `clientState` present and equal — no silent fallback.
- **Persistence:** a crash mid-write can never leave a torn store file; concurrent
  same-host writers serialize. Cross-host writes remain **BLOCKED** (see
  `docs/PERSISTENCE.md`).

## Tests run (real numbers, 2026-08-16)
- `npm test` → **12 passed / 0 failed** with a live local backend (11 skipped — all
  auth-gated; Invalid Login ran live 5/5). Without a live backend Invalid Login is
  also skipped: 11 passed / 12 skipped. *The 0.3.0 published figure was 10 passed;
  the Admin Preview Contract suite joined `npm test` (commit `5a3601c`), making the
  current real count 12 with a live backend.*
- `verify:security` → 34/34. `npm run build` → OK.
- `benchmark:dynamic` → **75/75**, leakage **0%** (scope 14/14, authz 21/21,
  recall 1/1, route 4/4, cache 6/6, freshness 6/6, error 0%).
- `test_org_integrity` 32/32 · `test_canonical_policy` 25/25 ·
  `test_legacy_shim_parity` 38/38 · `test_isolation_security` 46/46 ·
  `test_persistence_restart` 14/14 · `test_admin_preview_contract` 48/48 ·
  live backend invalid-login 5/5.

## Status tags
- **[VERIFIED IN CODE]** — all deterministic suites above; write-path org
  integrity; canonical authz bridge; persistence P2; preview contract.
- **[INFERRED FROM BEHAVIOR]** — admin console UI (build OK; no browser run).
- **[NOT RUN]** — Playwright/browser E2E (no MCP, no `TEST_ACCOUNT_PASSWORD`);
  auth-gated live suites (no `TEST_USERNAME`/`TEST_PASSWORD`).
- **[BLOCKED]** — multi-instance access-model persistence (filesystem-local
  advisory lock; Neon write-through for the access model NOT implemented).
- **[PROPOSED FUTURE STATE]** — automated event alerting/monitoring; Neon
  access-model adapter.

## Rollback
`git checkout codex/backup-before-final-hardening-20260816-2121` (exact 0.3.0
tree), or `git revert --no-commit 3f7795c 27cc3de b9a8760 2589a9e 5a3601c
6cd986c <final-docs-commit>` to keep later work. See `docs/ROLLBACK_PLAN.md`.

## Known limitations / deferred (honest)
- **Browser E2E (Playwright) NOT run** — Playwright MCP unavailable + no
  `TEST_ACCOUNT_PASSWORD`. Auth-gated live suites NOT run — no
  `TEST_USERNAME`/`TEST_PASSWORD`. These are reported as NOT RUN, never claimed
  passed.
- **Production-readiness verdict: READY WITH LIMITATIONS** — all deterministic
  code-level suites/security checks/benchmarks pass with zero failures and zero
  leakage; browser and live-auth verification remain outstanding.
- **Multi-instance access persistence BLOCKED** — advisory lock is
  filesystem-local; cross-host coordination and Neon write-through are not
  implemented (see `docs/PERSISTENCE.md`).
- `audit.jsonl` is line-atomic but not journaled/checksummed (a torn final line
  after an OS power loss is theoretically possible).
- Conversation cross-user *sharing* (deliberate hand-off) remains out of scope.

