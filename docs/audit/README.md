# Audit — BuildersEye

Status: **[VERIFIED IN CODE — auditStore.js]** · **[PROPOSED FUTURE STATE — Neon audit tables]**

## What is recorded
Every admin configuration change writes an immutable audit event via `server/access/auditStore.js`:

`who, what, when, previousValue, newValue, policyVersion, rollbackAction` — supporting policy **version history** and **rollback**.

## Verified coverage
- Permission/source/org config changes are audited by `adminService.js` before write. **[VERIFIED IN CODE]**
- Policy version is monotonic (`policy_version.json`) and used in cache keys, so permission changes invalidate affected caches. **[VERIFIED IN CODE]**
- No secrets, passwords, or tokens are recorded in audit events. **[VERIFIED IN CODE — audit payloads are policy/value diffs]**

## Proposed future
- Surfacing audit history in the Neon data source and a read-only audit viewer in the admin console. **[PROPOSED FUTURE STATE]**

## Related
- `docs/changes/CHG-org-access-redesign.md`
- `docs/AUTHORIZATION_MODEL.md`