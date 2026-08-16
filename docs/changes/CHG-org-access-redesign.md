# CHG-org-access-redesign — BuildersEye Organization & Authorization Redesign

Status: **Implemented (core) / Partially verified** · Branch: `codex/org-access-redesign-20260816`
Backup branch: `codex/backup-before-org-access-redesign-20260816-1050`
Baseline commit: `1a2c345`

## Change summary

Replace the flat 4-role model (CEO/HR/Manager/Employee) with a normalized domain model that separates **Identity**, **Organization**, and **Authorization**, enabling arbitrary org depth, multiple C-Level roles, employee move/deactivate, source linking, and policy-driven field/sheet/source redaction.

## Change ID / Version
- Change ID: `CHG-org-access-redesign`
- Version: `1.0.0`
- Reason: Scale from 150 demo employees to arbitrary employees and org hierarchies; CEO-controlled permissions without touching authz code for new job titles.
- Risk: High (authz + data model + API surface).

## Files changed (commits on task branch)
Core backend (`server/access/`): `accessModel.js`, `accessStore.js`, `scopeResolver.js`, `policyEngine.js`, `compatAdapter.js`, `auditStore.js`, `adminService.js`, `server/adminRoutes.js`.
RAG/data: `server/access/sourceLinks.js`, `server/rebuildVectors.js`, edits to `ingestExcel.js`, `registryIngest.js`, `onedriveSync.js`, `searchIndex.js`, `vectorStore.js`, `hybridSearch.js`, `sqlEngine.js`, `responseCache.js`, `chatController.js`, `semanticParser.js`.
Admin UI: `admin.html`, admin entry + assets (`src/` admin logic), `index.js` (wiring), `vectorStore.js`.
Templates: `docs/domain-model-design.md`.
Tests: `scripts/test_access_model.mjs`, `test_admin_service.mjs`, `test_admin_api.mjs`, `test_source_links.mjs`, `test_vector_staleness.mjs`, `test_scope_context.mjs`, `verify_rag_scope.mjs`.
Commit hashes: `7d66b25`, `edc81d5`, `34d959f`, `18933ad`, `23d2c7b`, `6727f50`, `5c5bd89`, `44c0a63`, `3a3bee9`.

## Data-flow impact
Ingestion now keys on source-link records; retrieval/SQL/vector receive an authorized scope pre-query; cache keys embed the policy version.

## Security impact
Deny-by-default; policy-driven redaction replaces hardcoded confidentiality maps; `requireAdmin` consults the access-profile `isAdmin`; cache keys versioned.

## Tests run
`npm test` → 8 passed / 0 failed (10 auth-gated skipped). `verify:security` → 34/34. `npm run build` → OK.

## Rollback
`git checkout codex/backup-before-org-access-redesign-20260816-1050` or revert the listed commits with `git revert`. See `docs/ROLLBACK_PLAN.md`.

## Known limitations
Reuse scope functions still have a `legacyResolveScope` shim (full consolidation deferred); Neon DDL write-through not wired (file-based local store); cross-user conversation scoping flagged, not yet done; Playwright MCP not available (browser E2E not run).