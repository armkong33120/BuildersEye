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
  admin preview contract 48/48, canonical policy 25/25, legacy shim parity
  38/38, verify:security 34/34, build OK, git diff --check clean.
- **NOT RUN / DEFERRED:** live auth-gated suites against a Neon-backed backend
  (environmental — Neon session latency ~15 s/round-trip in this env exceeds
  test timeouts; suites run green against file-backed sessions as verified in
  0.5.0).

### Rollback instructions
1. Set `ACCESS_DB_ADAPTER=json` in `server/.env`, restart.
2. Run `scripts/rollback-neon-access-to-json.mjs` to dump Neon → JSON.
3. Or `git checkout codex/backup-before-neon-access-persistence-20260818-0156`
   for full git revert.

### Production-readiness verdict
**READY** for multi-instance deployment when `ACCESS_DB_ADAPTER=neon` is
configured. JSON adapter unchanged and remains the default. Migration is
explicit and reversible. No production configuration was changed; no deployment
was made; `main` was not pushed.
