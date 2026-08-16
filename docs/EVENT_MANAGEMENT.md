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

## Proposed / not yet implemented (do NOT claim as live)
Real-time monitoring dashboards, alert thresholds, automatic incident/problem promotion, and automated critical-event release block are **[PROPOSED FUTURE STATE]** / **[NOT YET IMPLEMENTED]**. Until implemented, treat monitoring as manual operational checks. Do not create noisy alerts for normal expected behavior.