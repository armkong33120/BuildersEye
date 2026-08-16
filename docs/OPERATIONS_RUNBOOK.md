# Operations Runbook — BuildersEye

Status flags: **[VERIFIED IN CODE]** · **[MANUAL OP CHECK]** · **[PROPOSED FUTURE STATE]**

## Local dev
- Providers: `npm install`.
- Data prep: `npm run prepare:data`.
- Backend: `cd server && node index.js` (or `npm run dev:all` for frontend+backend).
- Frontend: `npm run dev` (Vite, port 5174).
- Re-index only via protected operation: `npm run index:hr` (server-side, admin authz). Do not re-index arbitrarily.
- Tests: `npm test`, `npm run verify:security`, `npm run benchmark`, `npm run benchmark:dynamic`.
- Backend refuses to boot without `JWT_SECRET` (and webhook validation requires `WEBHOOK_CLIENT_STATE`) — deny-by-default. **[VERIFIED IN CODE — observed in backend boot]**

## Health and readiness checks
- Boot log line `[access] Model seeded: 4 profiles, 2 policies, 150 employees` confirms the access store seeded. **[VERIFIED IN CODE — observed in backend boot]**
- `GET /api/registry/status` exposes `vectors.stale` (boolean). Use it to detect stale index. **[VERIFIED IN CODE]**
- Security: `npm run verify:security` → 34/34. **[VERIFIED]**
- Live scope check: `node scripts/verify_rag_scope.mjs` (requires running backend + `TEST_ACCOUNT_PASSWORD`). **[MANUAL OP CHECK — not run here, auth not configured]**
- Isolation regression: `node scripts/test_isolation_security.mjs` → 38/38. **[VERIFIED]**
- Restart durability: `node scripts/test_persistence_restart.mjs` → 9/9. **[VERIFIED]**
- Legacy shim parity: `node scripts/test_legacy_shim_parity.mjs` → 10/10 (2 documented divergences). **[VERIFIED]**
- Dynamic org benchmark: `npm run benchmark:dynamic` → 58/58, leakage 0%. **[VERIFIED]**
- Backend auth smoke: with a generated `JWT_SECRET`, `/api/health` OK; `/api/admin/*`, `/api/conversations`, `/api/debug/pipeline` all 401 without a token. **[VERIFIED]**

## Important operational events and safe actions
| Detection | Safe immediate action | Escalate? |
|---|---|---|
| Auth denial spike | Check authStore + rate limit counters; do not raise credentials | Warning if sustained |
| Authorization denials / RBAC fail | Inspect auditStore + policy_version; re-check policy version | Yes (security) |
| Cross-user access attempt / conversation ownership violation | Expect 403 from `conversationStore`; log correlationId; do NOT return data | Yes (security) |
| Debug pipeline served with stale policy version | `/api/debug/pipeline` drops the entry (policy version guard); user re-runs chat | No |
| OneDrive/Excel sync failure | Keep last-known-good index; expose `syncStatus=failed`; retry via protected re-index | If repeated |
| Stale index (`vectors.stale=true`) | Run protected re-index | If persists |
| Duplicate employee / cyclic manager | Validate in admin console; do not auto-fix | Yes |
| SQL failure / fallback activation | Review sqlRouting; SQL blocks non-SELECT | Yes if data impact |
| Vector empty/spike | Check scoped retrieval; confirm scope is passed pre-query | Yes if empty |
| Cache mismatch | Bump policy_version (auditStore) to invalidate | If persists |
| Admin preview shows BLOCKED for a privileged profile | Run `test_legacy_shim_parity.mjs` + `test_isolation_security.mjs`; check profile permissions | Yes if mismatch |
| `/api/debug/online` or `/api/registry/status` exposing more than allowed | Verify admin-gating (non-admins see self / configured-flag only) | Yes (security) |

## Event → Incident → Problem mapping guidance
For each event consider: what happened, which service, users affected?, data security affected?, safe immediate action, open Incident?, open Problem?, which Change can permanently fix it. **[PROPOSED FUTURE STATE — manual process until tooling implemented]**
