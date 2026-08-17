# Rollback Plan — BuildersEye org-access redesign + production hardening + final hardening

Changes: `CHG-org-access-redesign` (core), `CHG-production-hardening` (isolation/preview/benchmark/persistence review) and `CHG-production-hardening-final` (write-path org integrity, canonical authorization, persistence P2, preview contract) — safe rollback paths.

## Backup points
- **Live-gate backup:** `codex/backup-before-final-live-gate-20260817-1733` (baseline `a7df4cb`, tip of final-hardening branch). Task branch: `codex/final-live-gate-20260817` (fix commit `1d0d567`).
- **Org-redesign backup:** `codex/backup-before-org-access-redesign-20260816-1050` (baseline `1a2c345`).
- **Production-hardening backup:** `codex/backup-before-production-hardening-20260816-1208` (baseline `07d613a`, tip of org-redesign branch).
- **Final-hardening backup:** `codex/backup-before-final-hardening-20260816-2121` (baseline `54a1038`, tip of production-hardening branch).
- All work is on task branches; **no push to main**, **no production deploy**.

## How to roll back the final-live-gate (keep 0.4.0 final hardening)
1. **Restore branch (full revert to pre-live-gate tree):**
   ```
   git checkout codex/backup-before-final-live-gate-20260817-1733
   ```
   This restores the exact final-hardening tree (baseline `a7df4cb`).
2. **Revert the live-gate commit on top of current (keeps later work):**
   ```
   git revert --no-commit 1d0d567
   git commit -m "revert(CHG-final-live-gate): roll back jti + conversation-owner + test-hardening"
   ```
3. **Behavior note when reverting:** reverting restores the pre-fix `/api/chat`,
   where conversations were **not** persisted (owner passed as `title`, `userId`
   undefined) and the H2 cross-user 403 guard did **not** fire on the live API;
   access tokens issued in the same second were identical. Verify with
   `test_api_session_refresh.mjs` and `test_isolation_api.mjs` (they will fail as
   documented in `CHG-final-live-gate.md`).
4. **Data rollback:** the fix only affects conversation persistence (added
   `owner` rows under `server/.data/conversations/`) and JWT claims. No access-model
   files change format. Roll back `server/.data/conversations/` from backup only if
   needed.

## How to roll back final hardening (keep 0.3.0 + redesign)
1. **Restore branch (simplest, full revert to pre-final-hardening tree):**
   ```
   git checkout codex/backup-before-final-hardening-20260816-2121
   ```
   This restores the exact production-hardening tree (baseline `54a1038`) with all org-integrity/canonical-authorization/persistence-P2/preview-contract changes removed.
2. **Revert the final-hardening commits on top of current code (keeps later work):**
   ```
   git revert --no-commit 3f7795c 27cc3de b9a8760 2589a9e 5a3601c 6cd986c <final-docs-commit>
   git commit -m "revert(CHG-production-hardening-final): roll back org integrity + canonical authz + persistence P2 + preview contract"
   ```
   Commit hashes: `3f7795c` (write-path org integrity M2), `27cc3de` (canonical authorization Phase 3), `b9a8760` (M1 admin check / L2 / L4), `2589a9e` (persistence P2 atomic writes + advisory lock), `5a3601c` (static preview contract), `6cd986c` (benchmark write-path org-integrity section), plus the final docs commit.
3. **Behavior note when reverting:** reverting `3f7795c` re-enables the legacy behavior where the resolver collapses duplicate employee codes last-wins and breaks cycles silently instead of rejecting the write; reverting `2589a9e` returns access-store writes to non-locked/non-atomic JSON writes (single-writer-only again). Verify with the suites below.
4. **Data rollback for final hardening:** rejected writes are audited (`action:'rejected'`) but never persisted, so no data migration is required for org integrity. The advisory lock/atomic rename only changed how files are written, not their format. Roll back `server/.data/access/` from backup only if policy/profiles changed.

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
- `npm test` green (12 passed / 0 failed with a live backend on the final-hardening branch; 10/0 on the 0.3.0 branch; 8/0 on the pre-hardening backup).
- `npm run verify:security` → 34/34.
- `npm run benchmark:dynamic` → 75/75, leakage 0% (final-hardening tip).
- `node scripts/test_org_integrity.mjs` → 32/32 (final-hardening tip); `test_canonical_policy.mjs` → 25/25; `test_admin_preview_contract.mjs` → 48/48; `test_persistence_restart.mjs` → 14/14.
- Backend boots and seeds (boot log `[access] Model seeded: ...`).
- `git log` shows the backup branch tip.

## Security note
No secrets were committed; rollback does not require touching `.env`/`.env.local`.
