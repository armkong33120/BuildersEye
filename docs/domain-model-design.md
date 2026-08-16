# BuildersEye — Scalable Domain Model Design

**Author:** Domain Model Engineer
**Status:** Design deliverable (no implementation yet)
**Repository:** `mail-onedrive-org-graph`
**Audience:** backend-security, rag-data, and future implementers

---

## 0. Executive summary

BuildersEye currently derives authorization from a **flat 4-role string enum** (`CEO` / `HR` / `Manager` / `Employee`) that is computed from *job titles, department names, and hierarchy depth* (`authStore.js:27-36`). This conflates three concepts that must be separated for enterprise scale:

| Concept | Question it answers | Example | NEVER |
|---|---|---|---|
| **Identity** | *Who is this person?* | `employeeCode`, `name`, `employmentStatus` | — |
| **Organization** | *Where do they sit in the hierarchy?* | `jobTitle`, `orgLevel`, `department`, `managerCode` | used as an authz rule |
| **Authorization** | *What may they access?* | `accessProfile`, `permissions`, `scope`, field/source visibility | derived from a job title |

The redesign introduces five normalized entities — **Employee**, **Organization Relationship**, **Data Source Link**, **Permission Policy**, and **Access Profile** — plus one **canonical scope resolver** that replaces three divergent implementations. Job titles become display-only metadata; authorization is carried by an `accessProfile` pointer and versioned permission policies.

The migration maps the legacy roles to four access profiles (`CEO→GLOBAL_ADMIN`, `HR→HR_PRIVILEGED`, `Manager→TEAM_MANAGER`, `Employee→SELF_ONLY`) through a **compatibility adapter**, keeping the existing JWT/`viewer.role` surface intact while the normalized model is introduced underneath.

---

## 1. Design principles

1. **Three-concept separation is enforced structurally, not by convention.** Identity, Organization, and Authorization live in different entities with explicit foreign keys. A job title can never appear in a policy predicate.
2. **Stable, non-display identifiers are the only primary keys.** `employeeCode` (immutable) is the identity key. Display names (`name`, `jobTitle`, `department`) are never keys and never appear in policy `subjectId`/`resourceName` matching.
3. **Temporal validity everywhere it matters.** Employees, relationships, and policies carry `effectiveFrom`/`effectiveTo` + `version` so moving employees, changing managers, and deactivation are non-destructive and auditable.
4. **Policy versioning.** Permission policies are immutable-on-update (new version supersedes old). This gives reproducible access decisions and audit history.
5. **Deny-by-default.** Every access decision starts from "no access" and only grants through an explicit profile scope + policy allow. The current default-to-CEO fallbacks are removed.
6. **Backward compatibility via adapter, not via fork.** The legacy `viewer.role` string continues to be emitted for existing frontend/engine consumers during the transition, but it is *derived* from the normalized model, not stored as truth.
7. **Arbitrary hierarchy.** The org is a directed graph of temporal edges, not a fixed 4-level tree. Depth is *computed*, never stored.

---

## 2. Target domain model

### 2.1 Employee (Identity + Organization snapshot + Authorization pointer)

The employee record is the *denormalized current view* of a person. It carries identity fields, the current org position, and a pointer to an access profile. Historical org positions live in `organization_relationship` (2.2).

| Field | Type | Notes |
|---|---|---|
| `employeeCode` | string (PK) | **Stable, immutable** identity key. Format-agnostic (`EMP001`, `EMP0001`, UUID). Never re-used after deactivation. |
| `employeeId` | int (nullable) | **Legacy numeric key only.** Kept for backward compatibility with `flatIndex.employeeId` / `pk`. May be dropped for new tenants. |
| `name` | string | Display only. |
| `jobTitle` | string | **Organization metadata, display only.** Never an authz rule. |
| `orgLevel` | int (nullable) | Computed depth/band (0 = top). Informational; not an authz rule. |
| `department` | string | Organization metadata. Canonicalized to a stable `departmentCode` (see 2.6) for policy matching; display name kept separately. |
| `managerCode` | string (nullable) | Denormalized *current* manager pointer (FK → `employee.employeeCode`). |
| `employmentStatus` | enum | `active` \| `inactive` \| `terminated` \| `on_leave` \| `removed` (tombstone). |
| `accessProfile` | string (FK) | **Authorization pointer** → `access_profile.profileCode` (e.g. `TEAM_MANAGER`). |
| `effectiveFrom` | timestamp | Validity window start. |
| `effectiveTo` | timestamp (nullable) | Validity window end (null = current). |
| `version` | int | Optimistic concurrency / row version. |
| `createdAt` / `updatedAt` / `createdBy` / `updatedBy` | — | Audit. |

**Invariants:**
- `employeeCode` is assigned once at first sight and never changes, even across rehire (rehire re-activates the same code with a new `version` and `effectiveFrom`).
- `employeeId` may be null for tenants that never used numeric keys.
- `accessProfile` is required and defaults to `SELF_ONLY` (deny-by-default) when unknown.

### 2.2 Organization Relationship (temporal hierarchy edges)

Supports arbitrary depth (`COO → Manager ×1 → Lead ×3 → Junior ×10`), multiple C-level roles (CEO/COO/CFO/CTO), moving employees, and manager changes — all as versioned edges.

| Field | Type | Notes |
|---|---|---|
| `relationshipId` | string (PK) | Surrogate key. |
| `employeeCode` | string (FK) | The subordinate. |
| `managerCode` | string (FK) | The superior. |
| `relationshipType` | enum | `reports_to` \| `dotted_line` \| `matrix` \| `acting` \| `peer`. Default `reports_to`. |
| `effectiveFrom` | timestamp | When this edge became active. |
| `effectiveTo` | timestamp (nullable) | When it ended (null = current). |
| `version` | int | Row version. |
| `createdAt` / `createdBy` | — | Audit. |

**Semantics:**
- The *current* tree is the set of edges where `effectiveTo IS NULL`.
- A manager change = close the old edge (`effectiveTo = now`) + insert a new edge (`effectiveFrom = now`). Historical queries can reconstruct any point-in-time org.
- Multiple C-level roles are simply multiple nodes whose `managerCode` points to the same root (or null). No special-casing of "CEO".
- **Depth is computed** by walking edges (with cycle guard), exactly as `build-graph.js:46-58` already does. It is *not* stored as a fixed `hierarchyDepth` used for authz.
- `dotted_line` / `matrix` edges are *not* included in the default `SUBTREE` scope walk (only `reports_to` is), but can be referenced by explicit policies.

### 2.3 Data Source Link (breaks the 1:1 file↔employee assumption)

| Field | Type | Notes |
|---|---|---|
| `linkId` | string (PK) | Surrogate key. |
| `subjectType` | enum | `employee` \| `scope` \| `department` \| `org`. |
| `subjectId` | string | `employeeCode`, a scope code, or `departmentCode`. |
| `provider` | enum | `onedrive` \| `sharepoint` \| `local` \| `s3` \| … |
| `fileId` | string | Provider's file/item id (Graph `item.id`). |
| `fileName` | string | Display name. |
| `drivePath` | string | Provider path (`/me/drive/root:/Employees/...`). |
| `enabled` | bool | Whether this source feeds ingestion. |
| `syncStatus` | enum | `pending` \| `syncing` \| `synced` \| `error` \| `disabled`. |
| `lastSyncedAt` | timestamp (nullable) | Last successful sync. |
| `contentVersion` | string | Provider eTag / version stamp. |
| `hash` | string | Content hash for change detection (replaces filename-only delta). |
| `createdBy` / `updatedBy` | string | Audit. |

**Why:** today one employee = one `EMP\d{3}_OneDrive_Profile.xlsx` file (`ingestExcel.js:56`, `onedriveSync.js:122`, `employeeRegistry.js:34`). At scale, an employee may have many files, and a file may be shared across a department/scope. This link table is the many-to-many join.

### 2.4 Permission Policy (versioned authorization rules)

| Field | Type | Notes |
|---|---|---|
| `policyId` | string (PK) | Surrogate key. |
| `subjectType` | enum | `employee` \| `accessProfile` \| `department`. |
| `subjectId` | string | `employeeCode` \| `profileCode` \| `departmentCode`. |
| `resourceType` | enum | `file` \| `sheet` \| `field` \| `category`. |
| `resourceName` | string | e.g. `Base_Salary` (field), `Salary_History` (sheet), `compensation` (category). |
| `action` | enum | `read` \| `aggregate` \| `search`. |
| `effect` | enum | `allow` \| `deny` \| `redact`. |
| `priority` | int | Conflict resolution (higher wins; deny > redact > allow at equal priority). |
| `effectiveFrom` / `effectiveTo` | timestamp | Policy validity window. |
| `version` | int | Policy version (immutable on update). |
| `createdBy` | string | Audit. |

**Examples (decoupled from job titles):**
- `{subjectType: accessProfile, subjectId: TEAM_MANAGER, resourceType: field, resourceName: Base_Salary, action: aggregate, effect: allow, priority: 50}`
- `{subjectType: accessProfile, subjectId: TEAM_MANAGER, resourceType: field, resourceName: Base_Salary, action: read, effect: deny, priority: 50}`
- `{subjectType: accessProfile, subjectId: SELF_ONLY, resourceType: category, resourceName: compensation, action: read, effect: deny, priority: 100}`
- `{subjectType: accessProfile, subjectId: HR_PRIVILEGED, resourceType: field, resourceName: mainWeakness, action: read, effect: redact, priority: 60}`

**Resolution:** collect all policies matching the viewer's `employeeCode`, `accessProfile`, and `department`; order by `priority`; first decisive `deny`/`redact` wins; otherwise `allow`. This is the single source of truth for field/source visibility (replacing `SENSITIVE_FIELDS`, `VIEWER_ROLES.canSee*`, and `COMPENSATION_TERMS` regexes in `policy.js`).

### 2.5 Access Profile (catalog)

| Field | Type | Notes |
|---|---|---|
| `profileId` | string (PK) | Surrogate key. |
| `profileCode` | string (unique) | `GLOBAL_ADMIN` \| `HR_PRIVILEGED` \| `TEAM_MANAGER` \| `SELF_ONLY` \| extensible. |
| `label` | string | Human label. |
| `defaultScope` | enum | `ALL` \| `SUBTREE` \| `SELF` \| `NONE`. |
| `fieldVisibility` | json | Default field-level rules (or empty → policy-driven). |
| `sourceVisibility` | json | Default source-level rules. |
| `effectiveFrom` / `effectiveTo` | timestamp | Profile validity. |
| `version` | int | Row version. |

Access profiles are **authorization** concepts. They are assigned to employees via `employee.accessProfile`, and are *independent* of any job title. A COO (job title) may or may not hold `GLOBAL_ADMIN`; a `TEAM_MANAGER` profile may be held by a Lead or a COO.

### 2.6 Department catalog (supporting entity)

To avoid display-name-as-key, departments are canonicalized:

| Field | Type |
|---|---|
| `departmentCode` | string (PK) — e.g. `HR_ADMIN`, `FINANCE_ACCT` |
| `displayName` | string — e.g. `HR & Admin` |
| `effectiveFrom` / `effectiveTo` / `version` | — |

This fixes the `authStore.js:31` bug (`dept === 'HR / Admin'` vs real `'HR & Admin'`) at the root: matching is on `departmentCode`, never on a display string.

---

## 3. Access profile definitions & legacy mapping

| Legacy role | Access profile | defaultScope | Notes |
|---|---|---|---|
| `CEO` | `GLOBAL_ADMIN` | `ALL` | Full read/aggregate/search; no field redaction. |
| `HR` | `HR_PRIVILEGED` | `ALL` (with field redaction) | Full scope, but `redact` on non-HR-sensitive fields per policy. Fixes the current `resolveScope` returning `true` for HR despite the `HR_RECORDS` label (finding #8). |
| `Manager` | `TEAM_MANAGER` | `SUBTREE` | Self + descendants via `reports_to` edges. Compensation `aggregate` allowed on subtree; `read` of individual `Base_Salary` denied. |
| `Employee` | `SELF_ONLY` | `SELF` | Only own records; compensation category denied entirely. |

**Critical:** this mapping is a *default seed*, not a law. The normalized model allows:
- A COO with `TEAM_MANAGER` (not `GLOBAL_ADMIN`) — title and profile are decoupled.
- A non-manager granted a custom profile with `SUBTREE` scope via policy.
- Multiple C-level roles, each with their own profile assignment.

---

## 4. Canonical scope resolver (consolidation)

Today three implementations disagree (finding #4):
- `policy.js:48 resolveScope` — uses `identityGraph.subtreePks`/`directReportPks`.
- `registryIngest.js:82 buildScopeCodes` — walks `managerCode` directly.
- `chatController.js:498 buildScopeCodesForRole` — uses `subtreePks`/`directReportPks`.

**Design:** one resolver, one input contract, used by keyword/SQL/vector/analytics paths.

```
resolveAccess(viewer, target, ctx) -> {
  visible: boolean,
  scopeCodes: Set<employeeCode> | null,   // null = ALL
  allowedActions: Set<read|aggregate|search>,
  redactedFields: Set<fieldName>,
  redactedSources: Set<sourceId>,
}
```

Algorithm:
1. **Resolve profile** — `viewer.accessProfile` → `access_profile.defaultScope`.
2. **Compute scope codes** — from `organization_relationship` (walk `reports_to` edges from `viewer.employeeCode`), *not* from a cached `subtreePks`. `ALL` → null; `SELF` → `{viewer}`; `SUBTREE` → self + descendants; `NONE` → `{}`.
3. **Apply policies** — match by `employeeCode` + `profileCode` + `departmentCode`, ordered by `priority`, to produce `allowedActions`, `redactedFields`, `redactedSources`.
4. **Target check** — `target.employeeCode ∈ scopeCodes` (or scope is `ALL`).

This single function replaces:
- `policy.resolveScope` (deleted or re-exported as a thin alias),
- `registryIngest.buildScopeCodes` (deleted),
- `chatController.buildScopeCodesForRole` (deleted).

The SQL path (`sqlEngine.js`) and vector path (`vectorStore.js`) consume `scopeCodes` from this resolver. **Vector scope moves from post-retrieval filtering to pre-retrieval** (finding #5): pass `scopeCodes` into `searchVectors` (the Neon path already supports `meta->>'code' IN (...)`; the file path must be extended symmetrically).

---

## 5. Removing fixed `150` and `EMP\d{3}` assumptions

| Location | Current assumption | Change |
|---|---|---|
| `ingestExcel.js:72` | `employeeId < 1 \|\| employeeId > 150` | Remove upper bound; validate `> 0` only, or drop numeric key entirely. |
| `ingestExcel.js:56`, `onedriveSync.js:122`, `employeeRegistry.js:34` | `/^EMP\d{3}.*\.xlsx$/i` | Replace with a configurable pattern (`REGISTRY_FILE_PATTERN`, already exists in `employeeRegistry.js:34`) and derive `employeeCode` from file *content* (identity field), not filename. |
| `searchIndex.js:79`, `chatController.js:214,229` | `EMP\d{1,3}` / `EMP\d{3}` | Generalize to `EMP\d+` or any code pattern; match against `employeeCode` in the registry, not a regex on the query. |
| `vectorStore.js:2` comment, `authStore.js:81` | "150 คน" | Remove hardcoded count from messages; derive from registry. |
| 1:1 file↔employee | one file per employee | Replace with `data_source_link` (2.3). |
| `build-graph.js:60` | single `ceo` fallback | Support multiple C-level roots; `ceoPk` becomes `rootPks[]`. |

---

## 6. Migration strategy

### 6.1 Compatibility adapter (read path)

A single module `accessAdapter.js` exposes the legacy surface while reading the normalized model:

```
legacyViewer(user) -> { role: 'CEO'|'HR'|'Manager'|'Employee', employeeId, ... }
```

- `role` is *derived* from `employee.accessProfile` via the mapping in §3 (inverse of the seed).
- `employeeId` is `employee.employeeId` (or `employeeCode` if numeric key absent).
- Existing JWT claims (`role`, `employeeId`) remain unchanged during transition; `index.js:180` `req.viewer` construction is untouched.

This keeps `chatController`, `searchIndex`, `sqlEngine`, `semanticParser`, `responseCache`, and the frontend working without a big-bang rewrite.

### 6.2 Migration script

`migrate-domain-model.js` (one-time, idempotent, dry-run first):

1. **Read** existing `employees.json` (registry) + `identity-graph.json`.
2. **Create** `employee` rows: `employeeCode = code`, `employeeId = pk`, `accessProfile = map(roleForIdentity(...))` using the §3 seed.
3. **Create** `organization_relationship` rows from `managerCode` (one `reports_to` edge per employee, `effectiveFrom = firstSeen`).
4. **Create** `data_source_link` rows from `fileName`/`fileHash` (one per employee file).
5. **Create** `access_profile` catalog rows (§3) + seed `permission_policy` rows reproducing current `VIEWER_ROLES`/`SENSITIVE_FIELDS`/compensation behavior.
6. **Write** normalized JSON (`server/.data/domain/*.json`) and, if `DATABASE_URL` is set, the Neon tables (§7).
7. **Emit a report** of any employee whose mapped profile differs from the legacy role (e.g. a COO who was `Manager`) for human review.

### 6.3 Normalized internal model (write path)

New writes go only to the normalized model. The registry (`employeeRegistry.js`) becomes a *projection* of the domain model (still writing `employees.json` for the existing engine cache), but the domain model is the source of truth.

### 6.4 Deprecation notes

- `VIEWER_ROLES`, `SENSITIVE_FIELDS`, `COMPENSATION_TERMS`/`TEAM_AGGREGATE_TERMS`/`INDIVIDUAL_TARGET_TERMS`/`COMPANY_WIDE_TERMS` regexes in `policy.js` → replaced by `permission_policy` rows. Marked `@deprecated`, kept as fallback until policies are seeded.
- `roleForIdentity` / `usernameFor` in `authStore.js` → replaced by profile mapping; kept only inside the adapter.
- `subtreePks` / `directReportPks` / `hierarchyDepth` in `build-graph.js` → kept for the 3D visualization only; **no longer consumed by any authz path**.

---

## 7. Storage / DB schema proposal

The repo persists to **JSON files** (local dev) and **Neon Postgres** (prod, via `neonStore.js`). The design keeps both, adding normalized tables.

### 7.1 JSON (local dev) — `server/.data/domain/`

```
employees.json                  # employee entity (2.1)
organization_relationships.json # edges (2.2)
data_source_links.json          # (2.3)
permission_policies.json        # (2.4)
access_profiles.json            # (2.5)
departments.json                # (2.6)
```

### 7.2 Neon Postgres (prod) — additions to `initNeonSchema()`

```sql
CREATE TABLE IF NOT EXISTS employees (
  employee_code TEXT PRIMARY KEY,
  employee_id  INTEGER,               -- nullable legacy numeric key
  name TEXT, job_title TEXT, org_level INTEGER,
  department_code TEXT, department_display TEXT,
  manager_code TEXT,                  -- denormalized current manager
  employment_status TEXT NOT NULL DEFAULT 'active',
  access_profile TEXT NOT NULL DEFAULT 'SELF_ONLY',
  effective_from TIMESTAMPTZ, effective_to TIMESTAMPTZ,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT, updated_by TEXT
);

CREATE TABLE IF NOT EXISTS organization_relationships (
  relationship_id TEXT PRIMARY KEY,
  employee_code TEXT NOT NULL,
  manager_code  TEXT NOT NULL,
  relationship_type TEXT NOT NULL DEFAULT 'reports_to',
  effective_from TIMESTAMPTZ, effective_to TIMESTAMPTZ,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(), created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_org_rel_emp ON organization_relationships (employee_code, effective_to);
CREATE INDEX IF NOT EXISTS idx_org_rel_mgr ON organization_relationships (manager_code, effective_to);

CREATE TABLE IF NOT EXISTS data_source_links (
  link_id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  provider TEXT, file_id TEXT, file_name TEXT, drive_path TEXT,
  enabled BOOLEAN DEFAULT true,
  sync_status TEXT DEFAULT 'pending',
  last_synced_at TIMESTAMPTZ, content_version TEXT, hash TEXT,
  created_by TEXT, updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_dsl_subject ON data_source_links (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS permission_policies (
  policy_id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  resource_type TEXT NOT NULL, resource_name TEXT NOT NULL,
  action TEXT NOT NULL, effect TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  effective_from TIMESTAMPTZ, effective_to TIMESTAMPTZ,
  version INTEGER DEFAULT 1, created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_policy_subject ON permission_policies (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS access_profiles (
  profile_id TEXT PRIMARY KEY,
  profile_code TEXT UNIQUE NOT NULL,
  label TEXT, default_scope TEXT NOT NULL DEFAULT 'SELF',
  field_visibility JSONB, source_visibility JSONB,
  effective_from TIMESTAMPTZ, effective_to TIMESTAMPTZ, version INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS departments (
  department_code TEXT PRIMARY KEY,
  display_name TEXT,
  effective_from TIMESTAMPTZ, effective_to TIMESTAMPTZ, version INTEGER DEFAULT 1
);
```

**Existing tables are preserved** (`chunks`, `registry_meta`, `auth_sessions`, and the current `employees` table) for backward compatibility. The current `employees` table can be kept as the legacy projection, or migrated to the new `employees` shape in a later phase. `neonSync.js` write-through is extended to push the new tables.

---

## 8. Backward-compatibility strategy (summary)

1. **JWT surface unchanged** — `role` + `employeeId` claims stay; `index.js` `requireAuth`/`resolveViewer` untouched.
2. **`viewer.role` derived, not stored** — the adapter maps `accessProfile` → legacy role string.
3. **Legacy `employees.json` / `identity-graph.json` still written** — engines keep reading them until they are migrated to consume `scopeCodes` from the canonical resolver.
4. **`policy.js` exports kept as `@deprecated` shims** — `resolveScope` becomes a thin wrapper over `resolveAccess` so callers don't break on day one.
5. **Deny-by-default replaces default-to-CEO** — `resolveViewer` already returns `Employee`/`employeeId:0` (finding #2); the remaining `|| 'CEO'` fallbacks in `chatController.js:34`, `semanticParser.js:14`, `responseCache.js:27`, `sqlEngine.js:24` are changed to `SELF_ONLY`/`NONE`.

## 9. Rollout phases

1. **Phase 1 — model + migration (no behavior change).** Add tables/JSON, run migration, seed profiles+policies reproducing current behavior. Adapter emits identical `role` values.
2. **Phase 2 — canonical resolver swap.** Replace three scope functions with `resolveAccess`; verify keyword/SQL/vector parity via the existing `test_multirole_50x50.js` matrix.
3. **Phase 3 — remove hard limits.** Drop `150`/`EMP\d{3}`/1:1 file assumptions; enable `data_source_link` ingestion.
4. **Phase 4 — vector pre-retrieval scoping.** Pass `scopeCodes` into `searchVectors` (file + Neon paths).
5. **Phase 5 — decommission legacy.** Remove `VIEWER_ROLES` regex policy, `roleForIdentity`, and `subtreePks` authz consumption; delete `@deprecated` shims.

## 10. Risks & open questions

- **Parity risk** in Phase 2: the three scope functions currently disagree; the canonical resolver must be validated against the existing 50×50 role matrix before swap.
- **`employeeId` vs `employeeCode`** in `flatIndex`/SQL: `flatIndex` keys on `employeeId` (numeric). Migration must keep `employeeId` populated (or add `employeeCode` to every `flatIndex` row) to avoid breaking `sqlEngine`/`searchIndex`.
- **HR scope semantics** need a product decision: `HR_PRIVILEGED` default scope `ALL` with field redaction vs. a narrower `HR_RECORDS` scope (finding #8). Recommended: `ALL` + `redact` on non-HR-sensitive fields.
- **Cross-user leaks** (finding #6): `conversationStore` and `pipelineLatencies` are global. These are storage/scope issues adjacent to this model; recommend keying conversations by `employeeCode` and latencies per-tenant.
- **`ENABLE_TEST_CREDS=true`** in `render.yaml` (finding #10) and hardcoded test usernames (`emp135=HR`, `emp007=Manager`, `emp012=Employee`) must be removed/parameterized in the security workstream.
