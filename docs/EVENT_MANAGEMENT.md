# Event Management — BuildersEye

Status flags: **[VERIFIED IN CODE]** · **[PROPOSED FUTURE STATE]** · **[NOT YET IMPLEMENTED]**

## Structured event model
Each event carries (safe fields only, no secrets/personal data):
`eventId`, `eventType`, `source`, `service`, `severity` (INFORMATIONAL|WARNING|CRITICAL), `occurredAt`, `correlationId/requestId`, `actor`, `details` (no secrets), `threshold`, `responseAction`, `escalationRule`, `linkedIncidentId/ProblemId/ChangeId`, `suppressed`.

## Relationship
`Event → Incident → Problem → Change → Release → Verification`

## Implemented event handling
The following are represented in code today without inventing unavailable infra: **[VERIFIED IN CODE]**
- Authorization denial / RBAC boundary → `scopeResolver` + `policyEngine` deny-by-default; admin 401/403 in `adminRoutes`.
- Permission-policy version mismatch → cache keys embed `policy_version.json`; bump invalidates caches.
- Stale index → registry exposes `vectors.stale` boolean; org change triggers re-index.
- Sync failure → `syncStatus` on source-link; last-known-good data preserved (see OPERATIONS_RUNBOOK).
- SQL execution failure / fallback activation / vector empty/spike → existing `score.js`/`sqlRouting.js`/`responseCache` signals.
- Duplicate employee identity / cyclic manager hierarchy → `scopeResolver` cycle guard + admin validation.

## Production-hardening event catalogue (CHG-production-hardening)
Each event below uses the full schema. All are **[VERIFIED IN CODE]** as *detectable*
(detection point exists) or **[PROPOSED FUTURE STATE]** as *automated* (no live
alerting infra yet — treat as manual checks). `correlationId/requestId` = JWT
request trace; never include secrets or personal data.

| eventId | eventType | service | severity | detection point | safe details | response action | linked |
|---|---|---|---|---|---|---|---|
| EVT-CUA-001 | cross-user-access-attempt | chat/conversation | CRITICAL | `conversationStore` ownership check → 403 | attempted conversation id vs JWT owner mismatch | log actor id + correlationId; no data returned; open security Incident | Inc/Sec-*, Chg CHG-production-hardening |
| EVT-CVO-002 | conversation-ownership-violation | chat | CRITICAL | `addMessage`/`getConversation` owner guard | body-supplied conversationId of another user | reject (403), no side effects, audit log | Inc/Sec-*, Chg CHG-production-hardening |
| EVT-PVM-003 | policy-version-mismatch | cache/debug | WARNING | `/api/debug/pipeline` drops stale entries; cache key embeds pv | pipeline produced under older policy_version | drop stale pipeline, refetch | Prob/Cache-*, Chg CHG-production-hardening |
| EVT-CIF-004 | cache-isolation-failure | response-cache | CRITICAL | `responseCache` key = role+employeeId+pv | two users hitting same key (would indicate identity-key regression) | invalidate cache, review key builder | Inc/Sec-*, Chg CHG-production-hardening |
| EVT-PPM-005 | permission-preview-mismatch | admin-preview | WARNING | `POST /api/admin/preview` markers vs chat redaction (parity test) | documented HR/Manager-self divergences | run `test_legacy_shim_parity.mjs`; defer chat migration | Prob/Authz-*, Chg CHG-production-hardening |
| EVT-UAA-006 | unauthorized-admin-access | admin | CRITICAL | `requireAdmin` 403 | non-admin calling `/api/admin/*` | audit actor, rate-limit, Incident | Inc/Sec-*, Chg CHG-production-hardening |
| EVT-IHV-007 | invalid-hierarchy | org-model | WARNING | `scopeResolver` cycle guard / missing-manager root | cyclic manager edge observed | detect, report, do not auto-fix | Prob/Org-* |
| EVT-DEI-008 | duplicate-employee-identity | org-model | WARNING | write-path validation (NOT YET IMPLEMENTED — resolver is last-wins) | two records with same employeeCode | validate in admin console, dedupe | Prob/Org-*, DEFERRED |
| EVT-SIX-009 | stale-index | rag | WARNING | `vectors.stale` in `/api/registry/status` | index older than org snapshot | protected re-index (`npm run index:hr`) | Chg CHG-org-access-redesign |
| EVT-SLF-010 | source-link-failure | ingestion | WARNING | `canIngestSource`/`isSourceEnabled` | disabled/owned source blocked | re-enable via admin console; keep last-known-good | Prob/Data-* |
| EVT-BMR-011 | benchmark-regression | benchmark | WARNING | `npm run benchmark:dynamic` metrics | leakage rate > 0 or scope/authorization accuracy < 100% | block release, investigate scope resolver | Inc/Perf-*, Chg CHG-production-hardening |
| EVT-PWF-012 | playwright-failure | ui-e2e | WARNING | `npm run test:e2e` / admin-console browser flows | browser flow assertion failed | fix UI, re-run; report truthfully if unavailable | Chg CHG-production-hardening |
| EVT-DHF-013 | deployment-health-failure | backend | CRITICAL | `GET /api/health` / boot log | health non-ok or boot refused (JWT_SECRET etc.) | do NOT deploy; check env + logs | Inc/Infra-*, Chg CHG-production-hardening |

## Proposed / not yet implemented (do NOT claim as live)
Real-time monitoring dashboards, alert thresholds, automatic incident/problem promotion, and automated critical-event release block are **[PROPOSED FUTURE STATE]** / **[NOT YET IMPLEMENTED]**. Until implemented, treat monitoring as manual operational checks. Do not create noisy alerts for normal expected behavior.
