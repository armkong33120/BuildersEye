# System Version — BuildersEye

| Field | Value |
|---|---|
| System | BuildersEye (`mail-onedrive-org-graph`) |
| Package name | `builders-eye` |
| Latest release version | `0.2.0` (org & authorization redesign core) |
| Prior release | `0.1.0` |
| Task branch | `codex/org-access-redesign-20260816` |
| Backup branch | `codex/backup-before-org-access-redesign-20260816-1050` |
| Baseline commit | `1a2c345` |
| Commit subject example | `feat(access): normalized domain model + compatibility layer` |
| Change record | `docs/changes/CHG-org-access-redesign.md` |

## Component status
- Backend core (domain model, authz, admin API): **[VERIFIED IN CODE]**
- RAG/data integration (scope → ingest/index/SQL/vector/cache): **[VERIFIED IN CODE]**
- Admin console UI: **[INFERRED FROM BEHAVIOR]** (build OK; browser E2E not run — Playwright MCP unavailable)
- Neon production persistence: **[PROPOSED FUTURE STATE]**

## Verified test results (0.2.0)
- `npm test`: 8 passed / 0 failed (10 auth-gated skipped)
- `verify:security`: 34/34
- `npm run build`: OK (emits `dist/admin.html`)