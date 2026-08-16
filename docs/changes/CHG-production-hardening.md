# CHG-production-hardening — BuildersEye Production Hardening (isolation + preview + benchmark + persistence review)

Status: **Implemented / Partially verified** · Branch: `codex/production-hardening-20260816`
Backup branch: `codex/backup-before-production-hardening-20260816-1208`
Baseline commit: `07d613a`

## Change summary

Production-hardening follow-up to `CHG-org-access-redesign`. Fixes cross-user
isolation (conversation history, latestPipeline/debug state, chat memory), adds
the Admin "Preview As User" backend route (scoped to the selected user, status-only
output), makes the policy engine permission-aware (privileged profiles are never
denied by the seeded null-subject compensation policy), adds a dynamic-organization
benchmark, reviews legacy scope/redaction shims with a parity test, and documents
the persistence boundary (multi-instance access persistence remains BLOCKED).

## Change ID / Version
- Change ID: `CHG-production-hardening`
- Version: `1.0.0`
- Reason: Known cross-user isolation gaps (global latestPipeline, owner-less
  conversations, unpartitioned chat memory), missing admin preview backend,
  permission-preview mismatch, and unverified dynamic-org behavior.
- Risk: High (security-sensitive server changes).

## Files changed (commits on task branch)
Security/isolation:
- `server/conversationStore.js` — immutable owner on every conversation; list/get/delete/append enforce ownership (403/404).
- `server/chatMemory.js` — sessions keyed `userId:conversationId`.
- `server/pronounResolver.js`, `server/semanticParser.js`, `server/chatController.js` — history partitioned by user; owner passed on message append.
- `server/index.js` — `latestPipeline` scoped per user + invalidated on policy-version change; `/api/debug/online` admin-gated; `/api/registry/status` hides OneDrive account identity from non-admins; registry-detail + semantic search derive sensitive-redaction from access profile (not legacy role).
- `server/adminRoutes.js` — `POST /api/admin/preview` (admin-only).
- `server/access/adminService.js` — `previewAsUser`: evaluates the SELECTED user's profile+scope via the canonical engine, ignores body profileCode/username, returns `viewer` + status-only `records`, marks `isPreview`, audits with JWT actor.
- `server/access/policyEngine.js` — privileged exemption for null-subject DENY; profile-permission-aware `evaluatePolicies` (implicit ALLOW for canSeeCompensation/canSeeSensitive); tightened FIELD resource matching (removed cross-sheet substring over-match); added `isSensitiveResource`.
- `src/js/admin.js`, `src/styles/admin.css` — preview uses `employeeCode`, no profile override, stale-response sequence guard, PREVIEW MODE badge, policyVersion shown.
- `scripts/run_all_tests.mjs` — backend-health probe so HTTP-only suites skip (not fail) without a live server.

Tests/benchmark:
- `scripts/test_isolation_security.mjs` (38 unit cases), `scripts/test_isolation_api.mjs` (live, auth-gated).
- `benchmark/dynamic-org.mjs` (58 assertions; 24-employee multi-root org, not 150) + `npm run benchmark:dynamic`.
- `scripts/test_persistence_restart.mjs` (9 cases) — restart durability.
- `scripts/test_legacy_shim_parity.mjs` (10 cases) — scope 100% parity; 2 documented redaction divergences.

Docs:
- `docs/PERSISTENCE.md` (new), `docs/EVENT_MANAGEMENT.md`, `docs/OPERATIONS_RUNBOOK.md`, `docs/TEST_STRATEGY.md`, `docs/ROLLBACK_PLAN.md`, `docs/CHANGELOG.md`, `docs/SYSTEM_VERSION.md`.

Commit hashes: `f8b6e43`, `f1aad77`, `29899d2`, (final docs commit).

## Data-flow impact
Conversations and debug pipeline carry an owner; chat history/debug retrieval are
per-user; cache keys already embed policy version (unchanged); admin preview
returns field-status markers only (never real values).

## Security impact
No known cross-user data leakage remains in code-level paths (verified by
`test_isolation_security.mjs`). Request-body identity is never trusted. Preview is
scoped to the selected user and cannot render out-of-scope data. `/api/debug/online`
and `/api/registry/status` no longer leak user/account metadata to non-admins.

## Tests run
`npm test` → 10 passed / 0 failed (12 skipped: 11 auth-gated + 1 no-live-backend).
`verify:security` → 34/34. `npm run build` → OK. `benchmark:dynamic` → 58/58
(all metrics 100%: scopeCorrectness, leakage 0%, authorization accuracy, recall,
route, cache, freshness, error 0%).

## Rollback
`git checkout codex/backup-before-production-hardening-20260816-1208`, or revert
this change's commits with `git revert` (keep the org-redesign commits). See
`docs/ROLLBACK_PLAN.md`.

## Known limitations / deferred
- Browser E2E (Playwright) NOT run — Playwright MCP unavailable + no
  `TEST_ACCOUNT_PASSWORD`. Live auth-gated tests (incl. `test_isolation_api.mjs`)
  skipped. Reported truthfully.
- Chat redaction still uses legacy `policy.js:applyFieldRedaction` (2 documented
  divergences vs canonical; migration deferred until live E2E).
- `checkQueryPolicy` has no canonical engine equivalent (deferred).
- Neon write-through for the access model NOT implemented; multi-instance access
  persistence **BLOCKED** (see `docs/PERSISTENCE.md`).
- Duplicate employeeCode is not rejected in the admin write path (resolver is
  deterministic last-wins); cyclic hierarchy is broken (not rejected) by design.
- Conversation history is now file-backed + owner-scoped; cross-user conversation
  *sharing* (deliberate hand-off) is out of scope.
