# PERSISTENCE.md — Access-Model Persistence Review (Phase 5, production-hardening)

Status: **VERIFIED IN CODE** (file-backed behavior) · **NOT YET IMPLEMENTED** (Neon
write-through for the access model) · **BLOCKED** (multi-instance production readiness)

## 1. What is persisted, and where

The normalized **access model** (Identity / Organization / Authorization) is
authoritative in **JSON files under `server/.data/access/`**:

| Entity            | File                    | Created by                                    |
|-------------------|-------------------------|-----------------------------------------------|
| Access profiles   | `profiles.json`         | `seedAccessModel` (idempotent)                |
| Permission policies | `policies.json`        | `seedAccessModel` / `adminService`            |
| Employees (normalized) | `employees.json`    | `seedAccessModel` / `adminService`            |
| Organization relationships | `relationships.json` | `adminService` (temporal edges)           |
| Data source links | `source_links.json`     | `adminService`                                |
| Policy version    | `policy_version.json`   | `bumpPolicyVersion` (cache invalidation baseline) |
| Audit trail       | `audit.jsonl`           | `auditStore.recordAudit` (append-only)        |

Neon (`server/neonStore.js`, `server/neonSync.js`, `server/migrate-to-neon.js`)
currently covers **only the RAG/registry domain** (employees table + pgvector +
registry_meta). **It does not persist the access model.** A `DATABASE_URL` in the
environment does not change access-model storage.

## 2. Adapter boundary

`server/access/accessStore.js` **is the persistence boundary.** Its public API is
storage-agnostic (get/save functions). The documented intent is that a Neon
write-through adapter could be added behind this boundary without changing
`adminService` / routes / policy engine. Today the implementation is the JSON file
adapter. **No silent half-adapter exists**: every access read/write goes through
`accessStore`, and it is exclusively file-backed.

## 3. Runtime behavior

| Question                    | Verified behavior                                                                          |
|-----------------------------|--------------------------------------------------------------------------------------------|
| Runtime-authoritative       | JSON files under `server/.data/access/` (all processes share the same filesystem path).     |
| After process restart       | All 7 file-backed stores survive restart; in-memory `responseCache`, `latestPipelineByUser`, `chatMemory` reset (by design, bounded memory). Verified by `scripts/test_persistence_restart.mjs` (spawns a fresh process). |
| Multiple backend instances  | **NOT SAFE for concurrent admin writes.** No file locking; last-writer-wins on any file. Reads are safe. |
| Policy version shared       | Single `policy_version.json` on a shared filesystem → consistent version, but the bump is an unlocked write (two concurrent admins can both bump). |
| Source-link state durable   | Yes — `source_links.json`.                                                                  |
| Audit state durable         | Yes — `audit.jsonl`, append-only.                                                           |
| Concurrent admin editing    | Unlocked last-writer-wins. No optimistic-concurrency check on JSON writes.                  |

## 4. Production-readiness verdict for this area

**BLOCKED for multi-instance access persistence.** File-backed persistence is fine
for a single-instance demo/dev deployment and survives restarts, but:

1. Concurrent admin writes across instances can lose updates (no locking / no
   compare-and-swap on `saveEmployees`/`savePolicies`/etc.).
2. `policy_version` bump is not atomic across instances, so cache invalidation
   could theoretically race.
3. Full Neon write-through for the access model is **not implemented** and this
   task deliberately did not force it.

## 5. Migration / rollback design (PROPOSED FUTURE STATE)

A Neon write-through adapter should:

1. Add tables behind `accessStore`'s API: `access_profiles`, `access_policies`,
   `access_employees`, `access_relationships`, `access_source_links`,
   `access_policy_version`, `access_audit`.
2. Add `ACCESS_DB_ADAPTER=json|neon` (default `json`) — explicit opt-in, never
   silent. `adminService` still validates + audits; only the store layer changes.
3. Seed/one-way migration script `migrate-access-to-neon.mjs`: read the JSON
   stores, upsert rows, then set the adapter flag.
4. Rollback: set adapter back to `json` (the JSON files are kept current as the
   migration source of truth until the flag flips). Do NOT delete JSON files.
5. Concurrency: version each row (`version` column) and use conditional UPDATE
   (`WHERE version = ?`) so concurrent admin edits fail loudly instead of
   last-write-wins.
6. Keep `policy_version` in a single row with `SELECT ... FOR UPDATE` on bump.

## 6. Restart-behavior tests

`scripts/test_persistence_restart.mjs` (wired into `npm test`) proves:
- profiles / policies / employees / relationships / source links survive a full
  process restart (fresh `node` child, same `ACCESS_DATA_DIR`);
- `policy_version` survives restart (durable cache-invalidation baseline);
- `audit.jsonl` survives restart;
- `responseCache` is process-local and empty after restart (expected).

## 7. What was NOT done (honest)

- No Neon DDL / write-through for the access model (would require a live Neon
  instance and credential handling this task must not touch).
- No file locking / optimistic concurrency for JSON writes (single-instance
  assumption documented above).
- Production multi-instance access persistence remains **BLOCKED**.
