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
| EVT-IHV-007 | invalid-hierarchy | org-model | WARNING | write-path `orgIntegrity.js` validation → self-manager 400 / hierarchy cycle 409; read path stays crash-safe | cyclic or self-referencing manager edge proposed by an admin write | reject write (400/409), audit `action:'rejected'`, no partial write; do not auto-fix | Prob/Org-*, Chg CHG-production-hardening-final |
| EVT-DEI-008 | duplicate-employee-identity | org-model | WARNING | write-path `orgIntegrity.assertNoDuplicateEmployeeCodes` → 409 + audit; read path stays last-wins crash-safe | two records resolving to the same normalized employeeCode | reject write (409), audit `action:'rejected'`, no partial write; dedupe legacy data | Prob/Org-*, Chg CHG-production-hardening-final |
| EVT-SIX-009 | stale-index | rag | WARNING | `vectors.stale` in `/api/registry/status` | index older than org snapshot | protected re-index (`npm run index:hr`) | Chg CHG-org-access-redesign |
| EVT-SLF-010 | source-link-failure | ingestion | WARNING | `canIngestSource`/`isSourceEnabled` | disabled/owned source blocked | re-enable via admin console; keep last-known-good | Prob/Data-* |
| EVT-BMR-011 | benchmark-regression | benchmark | WARNING | `npm run benchmark:dynamic` metrics (75 assertions incl. write-path org-integrity) | leakage rate > 0 or scope/authorization accuracy < 100% or any org-integrity assertion fails | block release, investigate scope resolver / orgIntegrity.js | Inc/Perf-*, Chg CHG-production-hardening-final |
| EVT-PWF-012 | playwright-failure | ui-e2e | WARNING | `npm run test:e2e` / admin-console browser flows | browser flow assertion failed | fix UI, re-run; report truthfully if unavailable | Chg CHG-production-hardening |
| EVT-DHF-013 | deployment-health-failure | backend | CRITICAL | `GET /api/health` / boot log | health non-ok or boot refused (JWT_SECRET etc.) | do NOT deploy; check env + logs | Inc/Infra-*, Chg CHG-production-hardening |
| EVT-UAP-014 | unauthorized-preview | admin-preview | CRITICAL | `requireAdmin` 401/403 on `POST /api/admin/preview` (preview-contract suite) | non-admin or token-less preview attempt | reject 401/403, audit actor, no data returned, open security Incident | Inc/Sec-*, Chg CHG-production-hardening-final |
| EVT-PRM-015 | preview-mismatch | admin-preview | WARNING | `test_admin_preview_contract.mjs` (48 asserts) vs UI behavior | preview `records` status diverging from expected field-visibility/scope | run preview-contract suite; fix contract or UI; never claim browser-passed | Prob/Authz-*, Chg CHG-production-hardening-final |
| EVT-PBF-016 | policy-bridge-failure | chat/authz | CRITICAL | `canonicalQueryPolicy` + `applyFieldRedactionPolicy` bridge in chat (`test_canonical_policy`, 25/25) | chat query allowed/denied/redacted inconsistently with the canonical engine | run canonical-policy suite; block release on failure | Inc/Sec-*, Chg CHG-production-hardening-final |
| EVT-LSD-017 | legacy-shim-divergence | authz shim | WARNING | `test_legacy_shim_parity.mjs` (38/38) | legacy `policy.js` shim diverging from canonical beyond the documented zero-divergence set | run parity suite; migrate consumers off the deprecated shim | Prob/Authz-*, Chg CHG-production-hardening-final |
| EVT-AGT-018 | auth-gated-test-failure | ci/test | WARNING | `npm test` auth-gated suites (require `TEST_USERNAME`/`TEST_PASSWORD`) | an auth-gated suite failed while credentials were present | read failure, fix, re-run; without credentials report SKIPPED — never PASSED | Chg CHG-production-hardening-final |
| EVT-CWC-019 | concurrent-write-conflict | access-store | WARNING | `withAccessWriteLock` read-modify-write serialization (persistence suite 14/14) | two admin writers mutating the same data dir on one host | advisory lock serializes same-host writers; inspect audit/relationships for last-writer-wins | Prob/Persist-*, Chg CHG-production-hardening-final |
| EVT-PLT-020 | persistence-lock-timeout | access-store | WARNING | `withAccessWriteLock` ~5s timeout / stale-lock break via mtime | lock held > 5s or stale `.lock` dir detected at startup | retry; stale-lock auto-break; check for long/hung writes; no torn files (atomic rename) | Prob/Persist-*, Chg CHG-production-hardening-final |
| EVT-JWT-021 | jwt-token-uniqueness | auth | WARNING | `jti` claim in `issueTokens` (session-refresh suite 14/14) | two access tokens issued in the same second being identical (no `jti`) | ensure `jti` present; run `test_api_session_refresh.mjs` | Chg CHG-final-live-gate |
| EVT-CON-022 | conversation-ownership-not-enforced | chat | CRITICAL | `conversationStore.addMessage` owner arg in `/api/chat` (isolation API live 13/13) | body-supplied `conversationId` of another user not rejected (owner passed as `title`) | enforce owner (403), audit actor, no data returned | Inc/Sec-*, Chg CHG-final-live-gate |
| EVT-AGF-023 | auth-gated-suite-flake | ci/test | WARNING | 5/min login rate limit + LLM latency under burst (Cache Hit 5/5 isolated) | a live auth suite failing under clustered logins (429) | re-run isolated; space logins; raise timeouts | Chg CHG-final-live-gate |
| EVT-ADH-024 | admin-console-headless-network-error | ui-e2e | WARNING | `boot()` `/api/admin/profiles` probe client-side network error in headless (server returns 200, CORS correct) | harness/race artifact replacing admin content | verify via curl/API; do not claim section-render passed | Chg CHG-final-live-gate |
| EVT-NSL-025 | neon-session-latency | auth | WARNING | Neon `auth_sessions` round-trip ~15 s here vs ~0.1 s file-backed | auth suites exceed timeouts against a Neon backend in this environment | size Neon / raise test timeouts; not a product defect | Chg CHG-final-live-gate |

## Final-hardening event catalogue (CHG-production-hardening-final, 0.4.0)
The 0.4.0 final-hardening change adds **10 events** to the catalogue above:
3 updated in place — **EVT-IHV-007** (hierarchy cycle now rejected 400/409 on the write
path), **EVT-DEI-008** (duplicate employeeCode now rejected 409 on the write path,
no longer DEFERRED), **EVT-BMR-011** (benchmark now 75 assertions incl. write-path
org integrity) — and **7 new**: **EVT-UAP-014** (unauthorized preview),
**EVT-PRM-015** (preview mismatch), **EVT-PBF-016** (policy bridge failure),
**EVT-LSD-017** (legacy shim divergence), **EVT-AGT-018** (auth-gated test failure),
**EVT-CWC-019** (concurrent write conflict), **EVT-PLT-020** (persistence lock
timeout). All are **[VERIFIED IN CODE]** as *detectable* (a deterministic suite or
enforcement point exists); automated alerting remains **[PROPOSED FUTURE STATE]**.

## Proposed / not yet implemented (do NOT claim as live)
Real-time monitoring dashboards, alert thresholds, automatic incident/problem promotion, and automated critical-event release block are **[PROPOSED FUTURE STATE]** / **[NOT YET IMPLEMENTED]**. Until implemented, treat monitoring as manual operational checks. Do not create noisy alerts for normal expected behavior.
