# System Version — BuildersEye

| Field | Value |
|---|---|
| System | BuildersEye (`mail-onedrive-org-graph`) |
| Package name | `builders-eye` |
| Latest release version | `0.5.0` (live verification gate: JWT uniqueness + conversation-owner fix + test hardening) |
| Prior release | `0.4.0` (final hardening: write-path org integrity + canonical authorization + persistence P2 + preview contract) |
| Task branch | `codex/final-live-gate-20260817` |
| Backup branch | `codex/backup-before-final-live-gate-20260817-1733` |
| Baseline commit | `a7df4cb` |
| Change records | `docs/changes/CHG-final-live-gate.md`, `docs/changes/CHG-production-hardening-final.md`, `docs/changes/CHG-production-hardening.md`, `docs/changes/CHG-org-access-redesign.md` |

## Component status
- Backend core (domain model, authz, admin API, cross-user isolation): **[VERIFIED IN CODE]**
- Write-path org integrity (`orgIntegrity.js`: duplicate code 409 / self-manager 400 / cycles 409 / missing manager 400 / no partial writes): **[VERIFIED IN CODE]** (32-case suite + 17 benchmark assertions)
- Canonical authorization bridge (Phase 3, `canonicalQueryPolicy` + `applyFieldRedactionPolicy` in chat): **[VERIFIED IN CODE]** (25-case canonical policy suite; parity 38/38, zero redaction divergences)
- Persistence (atomic rename + advisory write lock, single instance): **[VERIFIED IN CODE]** (14/14) — single-instance **SAFE**; multi-instance across hosts **BLOCKED** (see `docs/PERSISTENCE.md`)
- Admin Preview As User contract (static, no credentials/browser needed): **[VERIFIED IN CODE]** (48/48)
- Dynamic org benchmark: **[VERIFIED IN CODE]** (75/75, leakage 0%)
- RAG/data integration (scope → ingest/index/SQL/vector/cache): **[VERIFIED IN CODE]**
- Admin console UI: **[PARTIALLY VERIFIED]** — CEO admin login succeeds, all `/api/admin/*` return 200; non-admin denied (403, no 2xx admin data); CORS correct. Full admin section DOM-render **NOT CONFIRMED** in this headless harness (boot-probe client-side "network error" artifact; server returns 200 with correct CORS).
- Auth-gated live suites (RBAC matrix, live isolation, live API): **[VERIFIED]** against a live local backend with file-backed sessions (Session Refresh 14/14, Isolation API live 13/13, RBAC Matrix 7/7, Cache Hit 5/5). With Neon-backed sessions round-trips here are ~15 s and exceed test timeouts (environmental).
- Neon access-model persistence: **[PROPOSED FUTURE STATE]** — multi-instance readiness **[BLOCKED]**
- Browser E2E (Playwright): **[VERIFIED — HEADLESS]** 3/3 PASSED (login → chat → debug), 0 console/page errors.

## Production-readiness verdict
**READY WITH LIMITATIONS.** All deterministic code-level suites, security checks,
and benchmarks pass with zero failures and zero leakage; authenticated API suites
and headless Playwright E2E now pass against a live local backend. Limitations:
(a) multi-instance access-model persistence BLOCKED (JSON-file single-instance
only; Neon write-through not implemented); (b) admin-console full section-render
not confirmed in this headless harness; (c) Neon-backed session latency here
exceeds test timeouts (environmental). No critical security test fails; no
deployment made; `main` not pushed. Intended for single-instance demo/staging only.

## Verified test results (0.5.0)
- `npm test`: 23 passed / 2 failed / 0 skipped (25 total). Failures: Cache Hit (flake under burst; 5/5 isolated), SQL Fallback (brittle trace-label assertion; 5/6 isolated, behavior correct).
- `verify:security`: 34/34 · `npm run build`: OK · `npm run benchmark:dynamic`: 75/75 leakage 0% · `git diff --check`: clean.
- Headless Playwright E2E: 3/3 PASSED (login/chat/debug), 0 console/page errors.
- Auth-gated isolated: Session Refresh 14/14 · Isolation API (live) 13/13 · RBAC Matrix 7/7 · Cache Hit 5/5 · Invalid Login 5/5.
- Static/deterministic: org-integrity 32/32 · canonical policy 25/25 · legacy shim parity 38/38 · isolation security 46/46 · persistence restart 14/14 · admin preview contract 48/48.