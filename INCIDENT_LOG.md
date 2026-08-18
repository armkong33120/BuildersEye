# Incident & Lessons Learned Log
> **Attention AI Agents:** 
> When you encounter a bug, system failure, or unexpected regression, **you MUST log it here**.
> Before making architectural or security changes, review this log to prevent repeating past mistakes.

## [2026-08-18] Incident: Login Page "Chicken-and-Egg" Blocked
**Symptom:**
Users could not log in. The login page (which displays demo credentials via an API call) was broken and returning network errors or timeouts during E2E tests (`e2e-live-login.mjs`).

**Root Cause:**
A security enhancement was made to `server/index.js` which added `requireAuth` to the `GET /api/preview/credentials` endpoint to prevent unauthenticated enumeration of test accounts.
However, the login page itself depends on this endpoint to render the test accounts *before* the user has logged in. Since the user has no JWT at that stage, the request failed with 401/403, completely blocking the login UI from functioning properly.

**Resolution:**
The `requireAuth` middleware was removed from `GET /api/preview/credentials`.
Instead of relying on JWT auth, the endpoint relies on an environment variable flag (`ENABLE_TEST_CREDS=true`) and verification inside `previewCredentials()` to ensure it only works in demo/test modes.

**Lesson for Future AIs:**
- **Do NOT** add `requireAuth` to `/api/preview/credentials` or any endpoint that is explicitly required by the pre-authentication UI (like the login page).
- Always trace the complete user flow (especially the entry points) when applying security middleware.
- When running automated E2E tests locally for the frontend (`app.html`), ensure you pass the local backend URL parameter (e.g., `?backend=http://localhost:5199`), otherwise the local frontend will default to testing the production backend, causing CORS errors and false test failures.

