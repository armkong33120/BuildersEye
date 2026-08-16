# System Version — BuildersEye

| Field | Value |
|---|---|
| System | BuildersEye (`mail-onedrive-org-graph`) |
| Package name | `builders-eye` |
| Latest release version | `0.3.0` (production hardening: isolation + preview + benchmark + persistence review) |
| Prior release | `0.2.0` (org & authorization redesign core) |
| Task branch | `codex/production-hardening-20260816` |
| Backup branch | `codex/backup-before-production-hardening-20260816-1208` |
| Baseline commit | `07d613a` |
| Change records | `docs/changes/CHG-production-hardening.md`, `docs/changes/CHG-org-access-redesign.md` |

## Component status
- Backend core (domain model, authz, admin API, cross-user isolation): **[VERIFIED IN CODE]**
- RAG/data integration (scope → ingest/index/SQL/vector/cache): **[VERIFIED IN CODE]**
- Admin console UI (incl. Preview As User contract): **[INFERRED FROM BEHAVIOR]** (build OK; browser E2E not run — Playwright MCP unavailable, no `TEST_ACCOUNT_PASSWORD`)
- Conversation/debug/cache isolation: **[VERIFIED IN CODE]** (38-case isolation test)
- Dynamic org benchmark: **[VERIFIED IN CODE]** (58/58, leakage 0%)
- Restart persistence: **[VERIFIED IN CODE]** (file-backed state survives restart; cache is process-local)
- Neon access-model persistence: **[PROPOSED FUTURE STATE]** — multi-instance readiness **[BLOCKED]** (see `docs/PERSISTENCE.md`)
- Chat redaction parity with canonical engine: **[VERIFIED IN CODE]** with 2 documented divergences (migration deferred)

## Verified test results (0.2.0)
- `npm test`: 8 passed / 0 failed (10 auth-gated skipped)
- `verify:security`: 34/34
- `npm run build`: OK (emits `dist/admin.html`)