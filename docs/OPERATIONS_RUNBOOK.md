# Operations Runbook — BuildersEye

Status flags: **[VERIFIED IN CODE]** · **[MANUAL OP CHECK]** · **[PROPOSED FUTURE STATE]**

## Local dev
- Providers: `npm install`.
- Data prep: `npm run prepare:data`.
- Backend: `cd server && node index.js` (or `npm run dev:all` for frontend+backend).
- Frontend: `npm run dev` (Vite, port 5174).
- Re-index only via protected operation: `npm run index:hr` (server-side, admin authz). Do not re-index arbitrarily.
- Tests: `npm test`, `npm run verify:security`, `npm run benchmark`.

## Health and readiness checks
- Boot log line `[access] Model seeded: 4 profiles, 2 policies, 150 employees` confirms the access store seeded. **[VERIFIED IN CODE — observed in backend boot]**
- `GET /api/registry/status` exposes `vectors.stale` (boolean). Use it to detect stale index. **[VERIFIED IN CODE]**
- Security: `npm run verify:security` → 34/34. **[VERIFIED]**
- Live scope check: `node scripts/verify_rag_scope.mjs` (requires running backend + `TEST_ACCOUNT_PASSWORD`). **[MANUAL OP CHECK — not run here, auth not configured]**

## Important operational events and safe actions
| Detection | Safe immediate action | Escalate? |
|---|---|---|
| Auth denial spike | Check authStore + rate limit counters; do not raise credentials | Warning if sustained |
| Authorization denials / RBAC fail | Inspect auditStore + policy_version; re-check policy version | Yes (security) |
| OneDrive/Excel sync failure | Keep last-known-good index; expose `syncStatus=failed`; retry via protected re-index | If repeated |
| Stale index (`vectors.stale=true`) | Run protected re-index | If persists |
| Duplicate employee / cyclic manager | Validate in admin console; do not auto-fix | Yes |
| SQL failure / fallback activation | Review sqlRouting; SQL blocks non-SELECT | Yes if data impact |
| Vector empty/spike | Check scoped retrieval; confirm scope is passed pre-query | Yes if empty |
| Cache mismatch | Bump policy_version (auditStore) to invalidate | If persists |

## Event → Incident → Problem mapping guidance
For each event consider: what happened, which service, users affected?, data security affected?, safe immediate action, open Incident?, open Problem?, which Change can permanently fix it. **[PROPOSED FUTURE STATE — manual process until tooling implemented]**