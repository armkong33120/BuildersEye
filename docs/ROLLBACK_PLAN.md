# Rollback Plan — BuildersEye org-access redesign

Change: `CHG-org-access-redesign` — safe rollback path.

## Backup points
- **Backup branch:** `codex/backup-before-org-access-redesign-20260816-1050` (points at baseline `1a2c345`).
- All work is on task branch `codex/org-access-redesign-20260816`; **no push to main**, **no production deploy**.

## How to roll back
1. **Restore branch (simplest, full revert):**
   ```
   git checkout codex/backup-before-org-access-redesign-20260816-1050
   ```
   This restores the exact pre-change tree.
2. **Revert the change commits on top of current code (keeps later work):**
   ```
   git revert --no-commit 3a3bee9 6727f50 44c0a63 23d2c7b 18933ad 34d959f edc81d5 7d66b25
   git commit -m "revert(CHG-org-access-redesign): roll back org/access redesign"
   ```
   (List all change commit hashes; see the change record for the full set.)
3. **Data/data-flow rollback:** restore `server/.data/access/` and `server/.data/registry/` from backup; remove `data_source_links` and any migrated JSON. If Neon tables were later added, drop new tables (not yet wired). **[VERIFIED IN CODE — no Neon write-through for new tables]**

## Verification after rollback
- `npm test` green.
- `npm run verify:security` → 34/34.
- Backend boots and seeds the legacy model (`role` from `roleForIdentity`, 150 employees).
- `git log` shows `1a2c345` as the tip of the backup branch.

## Security note
No secrets were committed; rollback does not require touching `.env`/`.env.local`.