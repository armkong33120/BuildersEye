# Rollback Plan — BuildersEye org-access redesign + production hardening

Changes: `CHG-org-access-redesign` (core) and `CHG-production-hardening` (isolation/preview/benchmark/persistence review) — safe rollback paths.

## Backup points
- **Org-redesign backup:** `codex/backup-before-org-access-redesign-20260816-1050` (baseline `1a2c345`).
- **Production-hardening backup:** `codex/backup-before-production-hardening-20260816-1208` (baseline `07d613a`, tip of org-redesign branch).
- All work is on task branches; **no push to main**, **no production deploy**.

## How to roll back (production-hardening first, keep redesign)
1. **Restore branch (simplest, full revert to pre-hardening tree):**
   ```
   git checkout codex/backup-before-production-hardening-20260816-1208
   ```
   This restores the exact org-redesign tree (baseline `07d613a`) with all isolation/preview/benchmark changes removed.
2. **Revert the hardening commits on top of current code (keeps later work):**
   ```
   git revert --no-commit f8b6e43 f1aad77 29899d2 <final-docs-commit>
   git commit -m "revert(CHG-production-hardening): roll back isolation/preview/benchmark changes"
   ```
3. **Data rollback for hardening:** conversation ownership was added to existing conversations on first write; roll back `server/.data/access/` from backup if policy/profiles changed. No Neon tables were added by this change (see `docs/PERSISTENCE.md`).

## How to roll back the org-access redesign entirely
1. `git checkout codex/backup-before-org-access-redesign-20260816-1050` (exact pre-redesign tree).
2. Or `git revert --no-commit` the org-redesign commits listed in `CHG-org-access-redesign.md`, keeping hardening commits on top if desired.
3. Restore `server/.data/access/` and `server/.data/registry/` from backup; remove any migrated JSON.

## Verification after rollback
- `npm test` green (10 passed / 0 failed on the hardening branch; 8/0 on the pre-hardening backup).
- `npm run verify:security` → 34/34.
- Backend boots and seeds (boot log `[access] Model seeded: ...`).
- `git log` shows the backup branch tip.

## Security note
No secrets were committed; rollback does not require touching `.env`/`.env.local`.
