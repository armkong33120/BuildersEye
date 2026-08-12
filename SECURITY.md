# Security Policy — BuildersEye RAG

## Threat Model

BuildersEye is an internal HR analytics RAG system that ingests employee data, indexes it into a searchable knowledge base, and exposes a chat API with role-based access control (RBAC). The system authenticates users via JWT and authorizes data access based on employee role (CEO, HR, Manager, Employee).

### Assets
| Asset | Sensitivity | Impact if compromised |
|-------|------------|----------------------|
| Employee PII (names, departments, job titles) | High | Privacy breach |
| JWT signing secret | Critical | Full impersonation of any user |
| OneDrive access tokens | Critical | Unauthorised file access |
| Neon Postgres connection string | Critical | Database takeover |
| LLM API key (DeepSeek) | High | API abuse / cost |
| User password hashes (bcrypt) | Medium | Brute-force risk if db stolen |

### Attack Surface
1. **Unauthenticated API endpoints** — debug endpoints, credential preview
2. **Weak test-mode credentials** — ENABLE_TEST_CREDS=true gives all 150 users the same known password
3. **Client-side security gates** — root/1234 in sessionStorage (trivially bypassed)
4. **Hardcoded secrets in frontend source** — test passwords embedded in HTML/JS
5. **Session hijacking** — JWT in localStorage (XSS risk)
6. **Brute-force login** — rate limiting exists but could be strengthened
7. **Secrets in documentation** — test credentials documented in markdown files


---

## Current Risks & Mitigations

### RISK: Hardcoded credentials in frontend source
- **Status**: FIXED (2026-08-19)
- **Before**: debug_neural_network_diagram.html contained hardcoded TEST_PASSWORD; index.html displayed the CEO password.
- **After**: Debug page now accepts the test password via the gate overlay (stored in sessionStorage, never hardcoded). Backend logs a loud warning when ENABLE_TEST_CREDS is true in production.

### RISK: Unauthenticated debug endpoints
- **Status**: FIXED (2026-08-19)
- **Before**: /api/debug/pipeline and /api/debug/online had NO authentication.
- **After**: Both endpoints now require requireAuth (valid JWT access token).

### RISK: Unauthenticated credential preview
- **Status**: FIXED (2026-08-19)
- **Before**: /api/preview/credentials returned the full user list without auth — user enumeration.
- **After**: Now requires requireAuth. The ENABLE_TEST_CREDS gate still applies (returns 403 if disabled).

### RISK: ENABLE_TEST_CREDS in production
- **Status**: MITIGATED (2026-08-19)
- **Before**: No warning when ENABLE_TEST_CREDS=true was set in production.
- **After**: authStore.js now logs a prominent console error block when NODE_ENV=production AND ENABLE_TEST_CREDS=true. Default (test mode off) gives each user a random bcrypt-hashed password — secure by default.

### RISK: Client-side admin gate (root/1234)
- **Status**: MITIGATED (2026-08-19)
- **Before**: debug_neural_network_diagram.html used sessionStorage as a gate, trivially bypassed.
- **After**: Backend debug endpoints now require real JWT auth. Client gate is cosmetic only.

### RISK: JWT in localStorage
- **Status**: ACCEPTED (trade-off)
- Tokens stored in localStorage (XSS risk). Mitigated by short-lived tokens (30 min), server-side refresh token hashing, and minimal payload (id, username, role, employeeId only).

### RISK: Secrets in environment file
- **Status**: MITIGATED
- server/.env is excluded by .gitignore. Verified not tracked in git.

---

## Deployment Checklist

- [ ] Set NODE_ENV=production
- [ ] Set ENABLE_TEST_CREDS=false
- [ ] Rotate JWT_SECRET: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] Rotate TEST_ACCOUNT_PASSWORD if it was ever used in production
- [ ] Rotate DEEPSEEK_API_KEY and DATABASE_URL if repo was ever public
- [ ] Verify .gitignore excludes server/.env and .env
- [ ] Run scripts/verify_security.mjs and review output
- [ ] Remove or IP-restrict debug_neural_network_diagram.html
- [ ] Set CORS_ORIGINS to production frontend URL only
- [ ] Review Azure Container Apps env vars for visible secrets

---

## Incident Response

If credentials are exposed:
1. Rotate the affected secret immediately
2. Check audit logs (App Insights login_ok / login_fail events)
3. Revoke all active refresh tokens (delete server/.data/auth/sessions.json or truncate auth_sessions table)
4. Regenerate user password hashes by deleting server/.data/auth/users.json and restarting

### Secret Rotation Commands
```
# Generate new JWT secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Generate new random password (24 chars)
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

---

## Dependency Security

- bcryptjs — password hashing (pure JS, no native deps)
- jsonwebtoken — JWT signing/verification
- express / cors — HTTP framework
- Run `npm audit` regularly

---

*Last updated: 2026-08-19 — Security audit pass*
