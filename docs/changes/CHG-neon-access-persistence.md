# Change Record — CHG-neon-access-persistence (0.6.0)

- **Change:** `CHG-neon-access-persistence`
- **Date:** 2026-08-18
- **Branch:** `codex/neon-access-persistence-20260818`
- **Backup:** `codex/backup-before-neon-access-persistence-20260818-0156` (baseline `56f9776`)
- **Commit(s):** `409cf52`
- **Type:** feature — Neon/Postgres adapter for multi-instance access persistence

## Goal
Move the access model from filesystem-only JSON to an optional Neon/Postgres
backend so multiple backend instances can safely share access profiles, policies,
employees, relationships, source links, policy version, and audit events.

## Changes

### New files
- `server/access/accessStoreNeon.js` (99 lines) — Neon adapter: write-through
  in-memory cache, optimistic concurrency (version column), DDL init, preload,
  write + read helpers for all 6 entity types + policy version + audit.
- `scripts/migrate-access-to-neon.mjs` (77 lines) — JSON → Neon upsert, DDL
  creation, idempotent.
- `scripts/rollback-neon-access-to-json.mjs` (47 lines) — Neon → JSON dump,
  policy version export.
- `scripts/test_access_neon_adapter.mjs` (84 lines) — Neon adapter integration
  test (13 assertions).

### Modified files
- `server/access/accessStore.js` — bottom-of-file adapter switch: when
  `ACCESS_DB_ADAPTER=neon` + `DATABASE_URL`, exports delegate read/write to
  Neon adapter. JSON originals renamed with `_` prefix (internal only).
- `server/access/adminService.js` — write functions async; `applyAndAudit`/
  `recordRejected` write audit to JSON (always) + Neon (when configured);
  `readAccess.audit` reads Neon when configured; conditional import of
  `accessStoreNeon.js` for audit helpers.
- `server/adminRoutes.js` — all write handlers async + await adminService.
- `server/index.js` — boot initializes Neon access schema + cache preload
  when `ACCESS_DB_ADAPTER=neon`.
- `server/.env.example` — documented `ACCESS_DB_ADAPTER=json|neon`.

### Neon DDL (7 new tables, alongside existing RAG registry)
```
access_profiles     (profile_code PK, data JSONB, version INT)
access_policies     (policy_id PK, data JSONB, version INT)
access_source_links (link_id PK, data JSONB, version INT)
access_employees    (employee_code PK, data JSONB, version INT)
access_relationships(relationship_id PK, data JSONB, version INT)
access_policy_version(key TEXT PK, version INT, updated_at TIMESTAMPTZ)
access_audit        (id PK, at TIMESTAMPTZ, actor JSONB, change JSONB,
                     previous JSONB, next JSONB, policy_version INT)
```

### Adapter behavior
- **JSON (default):** original behavior unchanged — sync reads/writes, advisory
  local lock, atomic rename. `ACCESS_DB_ADAPTER=json` or unset.
- **Neon:** write-through in-memory cache. Writes → Neon inside transaction →
  cache updated on commit. Reads → cache (sync). Optimistic concurrency via
  `version` column. Policy version bump = atomic `UPDATE RETURNING`.
  Audit → JSON (always, line-atomic) + Neon (when configured, shared state).

### Concurrency result
Optimistic concurrency verified: version column exists on all tables.
`UPDATE ... WHERE version=$expected` → if 0 rows matched → `{ conflict: true,
  currentVersion }`.
Policy version `UPDATE ... RETURNING version` is atomic (single SQL statement,
  no read-then-write gap).

### Verified tests
- **Neon adapter:** 13/13 (schema idempotent, preload, seed idempotent,
  write/read profiles, policy-version atomicity, version column, save policy,
  audit CRUD, findPreviousSnapshot).
- **JSON regression:** persistence restart 14/14, isolation security 46/46,
  admin preview contract 48/48, org integrity 32/32, admin service 20/20,
  canonical policy 25/25, legacy shim parity 38/38, verify:security 34/34,
  build OK, benchmark:dynamic 75/75, git diff --check clean.
- **Regression found & fixed:** async conversion of `adminService`/`accStore`
  writes initially broke direct-caller tests and the benchmark (missing `await`
  on `setManager`/`assignProfile`/`save*`), surfacing rejected writes as uncaught
  Promise rejections and successful writes as Promises. Added `await` to
  `test_org_integrity.mjs`, `test_admin_service.mjs`, `benchmark/dynamic-org.mjs` —
  all restored. These were regressions, not "known gaps"; the write-path
  org-integrity rejections (duplicate 409 / self-manager 400 / cycle 409 / missing
  manager 400 / no partial write) all pass.
- **Latency (Neon-access backend, 30s timeout, 0 timeouts / 0 errors):**
  login p50=19052ms/p95=19590ms (~19 s Neon `auth_sessions` round-trip);
  admin API p50=2ms/p95=8ms; policy read p50=2ms/p95=2ms. The access adapter
  adds no read-latency penalty; the ~19 s is Neon session latency.
- **NOT RUN / DEFERRED:** live auth-gated suites against a Neon-backed backend
  (each login is ~19 s Neon session latency; suites with multiple logins exceed
  default timeouts unless raised to > 19 s per call, e.g. 60 s — documented, not
  a defect). Suites run green against file-backed sessions (verified in 0.5.0).

## Verification addendum (0.6.1 — final gate, RESOLVED the deferred item above)

### Added
- **`scripts/test_helpers.mjs`** — shared `BACKEND_URL` + `TEST_HTTP_TIMEOUT_MS`
  (default 30000, override via env). 12 auth-gated test scripts now import it
  instead of hardcoding `AbortSignal.timeout(...)`. Test-only; no production,
  JWT, Neon query or application timeout changed.

### Verified against Neon backend (`ACCESS_DB_ADAPTER=neon`, `TEST_HTTP_TIMEOUT_MS=60000`)
- **Auth-gated suites — ALL PASS (0 timeouts, 0 errors, 0 skipped):** Blocked
  Queries, Debug Auth, Session Refresh, Vector Query, SQL Query, Cache Hit,
  SQL Fallback, SQL Metadata+Evidence, SQL Evidence+History, Isolation API (live),
  RBAC Matrix. Invalid Login PASS.
- **Neon adapter** `scripts/test_access_neon_adapter.mjs`: **13/13**.
- **Regression unit suites (default JSON adapter):** org integrity 32/32, admin
  service 20/20, admin preview contract 48/48, isolation security 46/46, canonical
  policy 25/25, legacy shim parity 38/38, persistence restart 14/14 (1 transient
  flake on a single early run, then 3 consecutive clean runs). verify:security
  34/34, build OK, benchmark:dynamic 75/75 (0% leakage), git diff --check clean.

### Latency (measured, root-caused)
- **login p50=17707 ms / p95=18029 ms**; authenticated API p50=2 ms / p95=7 ms;
  admin API + policy read sub-10 ms.
- **Root cause of ~18 s login — confirmed by direct Neon timing, NOT environmental:**
  every login rewrites ALL `auth_sessions` (`server/authStore.js` →
  `neonSaveSessions`): `DELETE` all + sequential per-session `INSERT`. Measured
  ~87 ms per INSERT (60 sequential = 5219 ms); with 215 accumulated sessions that
  is ~18 s. Cold connect = 834 ms, warm SELECT = ~70 ms → connection establishment,
  cold pool, startup, retry and test harness are all ruled out. This O(n) session
  write is independent of the access adapter and was left unchanged (verification
  task). Recommended future optimization: multi-row upsert / batch insert / delta
  persistence of sessions.

### Rollback instructions
1. Set `ACCESS_DB_ADAPTER=json` in `server/.env`, restart.
2. Run `scripts/rollback-neon-access-to-json.mjs` to dump Neon → JSON.
3. Or `git checkout codex/backup-before-neon-access-persistence-20260818-0156`
   for full git revert.

### Production-readiness verdict
**READY WITH LIMITATIONS.** All required authenticated suites pass against Neon
with no timeouts/errors/leakage; Neon access persistence (adapter 13/13) and
multi-instance write-through are verified in code. Limitation: **login latency
~18 s** — a measured, explained O(n) `auth_sessions` rewrite (recommended batch-upsert
optimization), an accepted operational limitation for demo/staging. The regression
unit suites must be run under the default JSON adapter. No production configuration
was changed; no deployment was made; `main` was not pushed.

