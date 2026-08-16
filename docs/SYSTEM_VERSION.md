# System Version — BuildersEye

| Field | Value |
|---|---|
| System | BuildersEye (`mail-onedrive-org-graph`) |
| Package name | `builders-eye` |
| Latest release version | `0.4.0` (final hardening: write-path org integrity + canonical authorization + persistence P2 + preview contract) |
| Prior release | `0.3.0` (production hardening: isolation + preview + benchmark + persistence review) |
| Task branch | `codex/final-hardening-20260816` |
| Backup branch | `codex/backup-before-final-hardening-20260816-2121` |
| Baseline commit | `54a1038` |
| Change records | `docs/changes/CHG-production-hardening-final.md`, `docs/changes/CHG-production-hardening.md`, `docs/changes/CHG-org-access-redesign.md` |

## Component status
- Backend core (domain model, authz, admin API, cross-user isolation): **[VERIFIED IN CODE]**
- Write-path org integrity (`orgIntegrity.js`: duplicate code 409 / self-manager 400 / cycles 409 / missing manager 400 / no partial writes): **[VERIFIED IN CODE]** (32-case suite + 17 benchmark assertions)
- Canonical authorization bridge (Phase 3, `canonicalQueryPolicy` + `applyFieldRedactionPolicy` in chat): **[VERIFIED IN CODE]** (25-case canonical policy suite; parity 38/38, zero redaction divergences)
- Persistence (atomic rename + advisory write lock, single instance): **[VERIFIED IN CODE]** (14/14) — single-instance **SAFE**; multi-instance across hosts **BLOCKED** (see `docs/PERSISTENCE.md`)
- Admin Preview As User contract (static, no credentials/browser needed): **[VERIFIED IN CODE]** (48/48)
- Dynamic org benchmark: **[VERIFIED IN CODE]** (75/75, leakage 0%)
- RAG/data integration (scope → ingest/index/SQL/vector/cache): **[VERIFIED IN CODE]**
- Admin console UI: **[INFERRED FROM BEHAVIOR]** (build OK; browser E2E NOT RUN — Playwright MCP unavailable, no `TEST_ACCOUNT_PASSWORD`)
- Auth-gated live suites (RBAC matrix, live isolation, live API): **[NOT RUN]** (no `TEST_USERNAME`/`TEST_PASSWORD`)
- Neon access-model persistence: **[PROPOSED FUTURE STATE]** — multi-instance readiness **[BLOCKED]**
- Browser E2E (Playwright): **[NOT RUN]**

## Production-readiness verdict
**READY WITH LIMITATIONS.** All deterministic code-level suites, security checks,
and benchmarks pass with zero failures and zero leakage; browser E2E and
auth-gated live suites were not executed in this environment and are reported as
NOT RUN, not claimed passed.

## Verified test results (0.4.0)
- `npm test`: 12 passed / 0 failed (11 skipped — all auth-gated; with a live backend Invalid Login runs 5/5; without one it is skipped too: 11 passed / 12 skipped)
- `verify:security`: 34/34
- `npm run build`: OK (emits `dist/admin.html`)
- `npm run benchmark:dynamic`: 75/75, leakage 0% (scope 14/14, authz 21/21, recall 1/1, route 4/4, cache 6/6, freshness 6/6, error 0%)
- `test_org_integrity` 32/32 · `test_canonical_policy` 25/25 · `test_legacy_shim_parity` 38/38 · `test_isolation_security` 46/46 · `test_persistence_restart` 14/14 · `test_admin_preview_contract` 48/48 · live backend invalid-login 5/5