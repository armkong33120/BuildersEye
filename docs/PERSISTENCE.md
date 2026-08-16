# PERSISTENCE.md — Access-Model Persistence Review (Phase 5 / P2, production-hardening)

Status: **VERIFIED IN CODE** (file-backed behavior) · **SAFE** (single-instance:
atomic rename + advisory write lock) · **BLOCKED** (multi-instance production
readiness — no cross-host lock; Neon write-through not implemented)

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
| Crash during a write        | **SAFE (single instance).** Every JSON mutation is committed via temp file + atomic `fs.renameSync` — a crash can never leave a torn/truncated store file; readers see the complete old or complete new content. Stale `.tmp-<pid>` files from a crash are removed on startup. |
| Concurrent admin editing    | **Serialized (same filesystem).** Mutation helpers (`saveProfiles`/`savePolicies`/`saveSourceLinks`/`saveEmployees`/`saveRelationships`/`bumpPolicyVersion`) acquire an advisory write lock (`withAccessWriteLock`, atomic `mkdir` on `.lock`, ~5s timeout, stale-lock break via mtime) and run their read-modify-write inside it. |
| Multiple backend instances  | **Single instance / same host: SAFE.** **Separate hosts: BLOCKED** — the lock is advisory and filesystem-local; there is NO cross-host lock (a host on another machine does not see `.lock`). |
| Policy version shared       | Single `policy_version.json`; the bump's read-modify-write runs inside the advisory lock and is committed atomically (serialized bumps, durable cache-invalidation baseline). |
| Source-link state durable   | Yes — `source_links.json`.                                                                  |
| Audit state durable         | Yes — `audit.jsonl`, append-only, line-atomic (single `O_APPEND` `write(2)` per event; a concurrent/crashed writer cannot tear a line). |
| Rollback                    | Supported via `adminService.rollback` (previous snapshots from `audit.jsonl`) — see `docs/ROLLBACK_PLAN.md`. |

## 4. Production-readiness verdict for this area

**Single instance: SAFE.** File-backed persistence with atomic temp-file +
`renameSync` and an advisory write lock is fine for a single-instance demo/dev
deployment and survives restarts, concurrent admin edits on the same host, and
crashes mid-write.

**Multi-instance (separate hosts): BLOCKED.** The advisory lock is filesystem-local
and cannot coordinate hosts that do not share the same data directory:

1. Two instances on separate hosts can each hold their own `.lock` — the lock
   only serializes writers on the same filesystem. Concurrent admin writes
   across hosts can still lose updates (last-writer-wins).
2. `policy_version` bumps are serialized only per filesystem, so cross-host cache
   invalidation could theoretically race.
3. Full Neon write-through for the access model is **not implemented**; this task
   deliberately did not force it (see §5).

A shared network filesystem (NFS/SMB) is NOT a substitute for a cross-host lock:
`mkdir`-based locks are not NFS-atomic in general, so multi-instance production
readiness stays **BLOCKED** until a real cross-host mechanism (e.g. Neon
write-through with conditional UPDATE, §5) lands.

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
- `responseCache` is process-local and empty after restart (expected);
- **concurrent writers serialize via the advisory lock**: two child processes
  hammer `saveEmployees` simultaneously and the final file is valid JSON equal
  to one complete writer payload (no torn/interleaved state);
- **atomic rename in use**: after writes there are no lingering `.tmp-*` files
  and the lock directory is released.

## 7. What was NOT done (honest)

- No Neon DDL / write-through for the access model (would require a live Neon
  instance and credential handling this task must not touch).
- No **cross-host** write lock: the advisory lock serializes writers that share
  a filesystem/data dir only. Production multi-instance access persistence
  remains **BLOCKED**.
- No optimistic-concurrency (compare-and-swap) on JSON writes; within one host
  the advisory lock serializes mutations, across hosts it does not.
- `audit.jsonl` uses line-atomic append (verified for typical event sizes); it
  is not journaled/checksummed, and a torn final line after an OS crash is
  possible in theory (a line that was being written when the machine lost power).
