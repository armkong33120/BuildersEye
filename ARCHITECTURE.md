# BuildersEye — Architecture & Maintainability

> Generated 2026-08-12. Maps the **actual** code as imported by `server/index.js` → `server/chatController.js`.

---

## 1. System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CLIENT (Vercel)                               │
│  index.html  ·  app.html  ·  debug_neural_network_diagram.html       │
│  Vanilla JS + Three.js 3D org graph + chat UI                        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ HTTPS (JWT Bearer)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│              BACKEND (Azure Container Apps :5199)                     │
│                                                                      │
│  server/index.js  ── Express router + startup + middleware           │
│       │                                                              │
│       ├── /api/auth/*       →  authStore.js (JWT login/refresh)      │
│       ├── /api/chat         →  chatController.js (RAG pipeline)      │
│       ├── /api/registry/*   →  employeeRegistry.js                   │
│       ├── /api/search/*     →  hybridSearch.js + llmRerank.js        │
│       ├── /api/webhook/*    →  onedriveWebhook.js                    │
│       ├── /api/sync/*       →  onedriveSync.js                       │
│       ├── /api/conversations→  conversationStore.js                  │
│       └── /api/debug/*      →  latestPipeline (in-memory)            │
│                                                                      │
│  Startup: neonSync → onedriveWebhook → blobSync → ingest/registry    │
│           → initDatabase → seedUsers → buildVectorIndex              │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
          ┌───────────────┐    ┌──────────────────┐
          │  Neon Postgres │    │  Azure Blob      │
          │  (employees,   │    │  (vector backups) │
          │   vectors,     │    └──────────────────┘
          │   auth_sessions│
          │   onedrive_tokens)│
          └───────┬───────┘
                  │
          ┌───────┴───────┐
          │  OneDrive      │
          │  (Excel files) │
          └───────────────┘
```


## 2. Module Boundaries

| Category | Files | Responsibility |
|----------|-------|----------------|
| **Ingestion** | `ingestExcel.js`, `employeeRegistry.js`, `registryIngest.js`, `runRegistry.js` | Load Excel → flat records; build employee registry |
| **Chunking/Indexing** | `searchIndex.js`, `localEmbedder.js`, `vectorStore.js`, `vectorEngine.js`, `chunker.js` | Inverted index, embeddings, vector index |
| **Retrieval** | `searchIndex.js`, `semanticParser.js`, `intentParser.js`, `sheetAliases.js`, `hybridSearch.js` | Keyword (7 matchers), semantic intent, sheet detection, hybrid fusion |
| **Policy/RBAC** | `policy.js` | Query policy, scope resolution, field redaction |
| **SQL Analytics** | `sqlEngine.js`, `analyticsEngine.js` | Text-to-SQL generation, analytics aggregates |
| **Generation** | `llmClient.js`, `anonymizer.js`, `pronounResolver.js`, `llmRerank.js` | LLM calls, PII anonymization, pronoun resolution, reranking |
| **Tracing** | `appInsightsSetup.js` | Azure App Insights audit events |
| **Auth/Session** | `authStore.js` | JWT login/refresh/logout, user seeding, rate limiting |
| **Storage** | `neonStore.js`, `neonSync.js`, `blobSync.js`, `onedriveSync.js`, `onedriveWebhook.js` | Neon Postgres, Azure Blob, OneDrive sync |
| **Memory/Cache** | `chatMemory.js`, `responseCache.js`, `conversationStore.js` | Short-term memory, response cache, conversation persistence |
| **CLI Tools** | `build-graph.js`, `build-registry.js`, `build-vectors.js`, `connect-onedrive.js`, `sync-onedrive.js`, `upload-vectors.js`, `migrate-to-neon.js`, `evalRag.js`, `mcpServer.js` | Standalone utilities; not imported by API flow |

---

## 3. Request Lifecycle: `POST /api/chat`

```
User Query
    │
    ▼
┌── q ── query received ──────────────────────────────────────────┐
│                                                                  │
│  ┌── pol ── policy check ── BLOCKED? → return "Query blocked"    │
│  │                                                                │
│  ├── sql ── regex detect: analytics needed? (avg/sum/bonus etc)  │
│  │                                                                │
│  ├── pron ── resolve pronouns from conversation history          │
│  │                                                                │
│  ├── cache ── LLM on? → check response cache                     │
│  │   ├── HIT → return cached answer (mem trace only)             │
│  │   └── MISS → continue                                         │
│  │                                                                │
│  ├── sem ── semantic intent parse (LLM)                          │
│  │   ├── CLARIFICATION → return clarification prompt             │
│  │   └── OK → continue                                           │
│  │                                                                │
│  ├── scope ── build RBAC scope codes for viewer role             │
│  │                                                                │
│  ├── sheet ── detect sheet name mentions in query                │
│  │                                                                │
│  ├── kw ── keyword search (7 matchers: exact, fuzzy, analytics,  │
│  │   │    department, job-title, name, employee-code)             │
│  │   │                                                           │
│  │   ├── rbac ── resolve scope per hit + field redaction         │
│  │   │                                                           │
│  │   └── BRANCH: where does the answer come from?                │
│  │       │                                                       │
│  │       ├── [SQL ROUTE] needsSqlAnalytics + isTextToSql         │
│  │       │   ├── sqle ── generateAndRunSQL (scoped table)        │
│  │       │   ├── ctx ── SQL context build                        │
│  │       │   └── llm ── format SQL results → Thai answer         │
│  │       │                                                       │
│  │       ├── [VECTOR ROUTE] VECTOR_SEARCH intent or empty keyword│
│  │       │   ├── emb ── embed query (local e5-small, 384d)       │
│  │       │   ├── vec ── search vector store (k=15)               │
│  │       │   ├── ctx ── tagged context with sheet labels         │
│  │       │   └── llm ── generate answer from vectors             │
│  │       │                                                       │
│  │       └── [KEYWORD ROUTE] fallback: keyword hits exist        │
│  │           ├── anom ── anonymize PII (tier 1/2/3)              │
│  │           ├── ctx ── anonymized context                       │
│  │           ├── llm ── generate answer (Tier 1 → rewrite only)  │
│  │           └── tpl ── template fallback if LLM fails           │
│  │                                                               │
│  └── answer enrichment: extract EMP codes + names from answer    │
│      for graph highlighting                                       │
└──────────────────────────────────────────────────────────────────┘
```

### Decision Tree Summary

```
needsSqlAnalytics AND (isTextToSql OR analytics matcher)
  → SQL ROUTE: generateAndRunSQL → LLM format → answer

┌─ no keyword hits ─┐
│  OR               │→ VECTOR ROUTE: embed → search → LLM generate
│  VECTOR_SEARCH     │
└───────────────────┘

┌─ keyword hits ─┐
│  AND LLM on    │→ KEYWORD+LLM: anonymize → context → LLM generate
└────────────────┘

┌─ keyword hits ─┐
│  AND LLM off   │→ TEMPLATE: return sr.answer directly
└────────────────┘

CACHE HIT or POLICY BLOCK → early exit (no retrieval)

---

## 4. Auth/Session Flow

```
POST /api/auth/login  {username, password}
  → verify credentials → issue JWT accessToken (30min) + refreshToken (7d)
  → store session hash in Neon auth_sessions (or local file)

POST /api/auth/refresh  {refreshToken} → new accessToken + rotated refreshToken
POST /api/auth/logout   {refreshToken} → revoke session

Protected routes: requireAuth → verifyAccessToken(JWT)
  → req.authUser = {role, employeeId, username, ...}
  → req.viewer = {role, employeeId}

Admin: requireAdmin → role==='CEO' || isAdmin
Privileged: requirePrivileged → role==='CEO' || role==='HR'
```

---

## 5. Data Flow

```
INGESTION:
  Excel files (OneDrive/local)
    ├── ingestExcel.js → flatIndex[] (all rows, all sheets)
    └── employeeRegistry.js → buildRegistry()
            ├── registryIngest.js → flatIndex + searchIndex (inverted index Map)
            └── build-vectors.js
                ├── chunker.js → text chunks
                ├── localEmbedder.js → 384d embeddings (e5-small)
                └── vectorStore.js → save to disk (.cache/)

PERSISTENCE:
  ├── Neon Postgres: employees, chunks+embeddings, auth_sessions, onedrive_tokens
  └── Azure Blob: vector backup (cold start recovery)

REALTIME SYNC:
  onedriveWebhook.js ← Microsoft Graph change notification
    → syncAll() → buildRegistry() → reloadData() → pushTokensToNeon()

AUTO-SYNC (index.js background):
  Every 30min, if last sync >24h → syncAll → rebuild registry → reloadData
```


---

## 6. Failure & Fallback Behavior

| Failure Point | Fallback | User Impact |
|--------------|----------|-------------|
| `policy.js` blocks query | Return "Query blocked" immediately | Answer blocked, trace ends at `pol` |
| `semanticParser` throws | `parsedIntent = null`, continue with keyword | Degraded intent matching |
| Keyword search returns 0 hits | Route to vector search | Slower but may find results |
| Vector search throws | Keep keyword answer; log warning | Returns keyword results |
| Vector search returns 0 hits | Template answer from keyword sr.answer | Returns raw match text |
| SQL engine errors | Fall back to keyword+LLM or template | Degraded analytics |
| LLM unavailable | Template answer (sr.answer) | Returns raw keyword/text results |
| Anonymizer Tier 1 (Strict) | Skip LLM; rewrite-only prompt | No PII sent to LLM |
| Cache miss | Continue normal flow | Normal latency |
| Registry empty at startup | Fall back to `loadDataFromFiles()` | May use stale local files |
| neonSync pull fails | Log warning, continue with local cache | Startup proceeds |
| blobSync fails | Log warning, skip vector restore | Vectors rebuilt locally |
| Webhook renewal fails | Log warning, retry next interval | Sync may lag behind |

---

## 7. Trace Node Mapping

Nodes emitted in `chatController.js` trace array. Order matches actual execution path.

| Node | Label | Always? | Notes |
|------|-------|---------|-------|
| `q` | Query received | ✅ | First node always |
| `pol` | Policy check | ✅ | "Allowed" or "Blocked" |
| `sql` | SQL detect | ✅ | "analytics" or "none" |
| `pron` | Pronoun resolve | ✅ | "resolved" or "none" |
| `cache` | Response cache | ✅ (LLM on) | "hit", "miss", or "off" |
| `sem` | Semantic intent | ✅ (past cache) | "ok", "clarification", "failed" |
| `scope` | RBAC scope | ✅ (past sem) | "scoped(N)" or "unrestricted" |
| `sheet` | Sheet mentions | ✅ | Comma-separated or "none" |
| `kw` | Keyword search | ✅ (past sem) | "N hits" |
| `rbac` | RBAC re-check | ✅ (past kw) | "N redacted, N blocked" |
| `sqle` | SQL engine | ❌ SQL route | SQL result or error note |
| `emb` | Embed query | ❌ Vector route | "query embedded" |
| `vec` | Vector search | ❌ Vector route | "N hits" |
| `ctx` | Context build | ❌ LLM path | "sql/vector/anonymized context ready" |
| `anom` | Anonymize | ❌ Keyword+LLM | "tier: Tier N" |
| `llm` | LLM generate | ❌ LLM path | "sql/vector/anonymized/rewrite answer generation" |
| `tpl` | Template fallback | ❌ No LLM/SQL | "template answer used" |
| `mem` | Memory save | ❌ Cache hit | "cached answer saved to memory" |

### Example Traces

**Cache hit** (6 nodes):
`q → pol → sql → pron → cache(hit) → mem`

**SQL analytics** (13 nodes):
`q → pol → sql(analytics) → pron → cache(miss) → sem(ok) → scope → sheet → kw → rbac → sqle → ctx → llm`

**Vector fallback** (14 nodes, empty keyword):
`q → pol → sql(none) → pron → cache(miss) → sem(ok) → scope → sheet → kw(0) → rbac → emb → vec → ctx → llm`

**Keyword+LLM** (13 nodes):
`q → pol → sql(none) → pron → cache(miss) → sem(ok) → scope → sheet → kw(N) → rbac → anom → ctx → llm`

**Template fallback** (12 nodes, LLM off):
`q → pol → sql(none) → pron → cache(off) → sem(ok) → scope → sheet → kw(N) → rbac → ctx → tpl`


---

## 8. API Route Map

| Method | Path | Auth | Handler |
|--------|------|------|---------|
| GET | `/api/health` | None | Health + index stats |
| GET | `/api/index/status` | None | Index details |
| POST | `/api/auth/login` | None | Login → JWT |
| POST | `/api/auth/refresh` | None | Refresh token |
| POST | `/api/auth/logout` | None | Revoke session |
| GET | `/api/auth/me` | JWT | Current user |
| GET | `/api/preview/credentials` | JWT | Test credentials (if enabled) |
| POST | `/api/chat` | JWT + Ready | Main RAG chat |
| GET | `/api/debug/pipeline` | JWT | Latest chat trace |
| GET | `/api/debug/online` | JWT | Online users |
| GET | `/api/debug/latency` | JWT | Pipeline + LLM latency stats (p50/p95) |
| GET | `/api/conversations` | JWT | List conversations |
| GET | `/api/conversations/:id` | JWT | Get conversation |
| DELETE | `/api/conversations/:id` | JWT | Delete conversation |
| POST | `/api/webhook/onedrive` | Graph validation | OneDrive change notification |
| GET | `/api/registry/status` | JWT | Registry + sync + OneDrive + vector status |
| GET | `/api/registry/employees` | JWT | Employees (scoped) |
| GET | `/api/registry/employees/:code` | JWT | One employee (scoped) |
| GET | `/api/registry/schema` | JWT (CEO/HR) | Registry schema (sensitive sheets gated) |
| POST | `/api/search/semantic` | JWT | Hybrid/vector/hyde/rerank debug search |
| POST | `/api/sync/onedrive` | JWT + CEO/HR | Trigger OneDrive delta sync + registry rebuild |

---

## 9. Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `JWT_SECRET` | HS256 signing key | ✅ Always |
| `LLM_API_KEY` | DeepSeek API key | ✅ Always |
| `LLM_BASE_URL` | LLM endpoint | ✅ (default: api.deepseek.com) |
| `LLM_MODEL` | Model name | ✅ (default: deepseek-v4-flash) |
| `DATABASE_URL` | Neon Postgres connection | Cloud |
| `HR_DATA_DIR` | Local Excel data directory | Local |
| `PUBLIC_BACKEND_URL` | Webhook callback URL | OneDrive webhooks |
| `AZURE_STORAGE_CONNECTION_STRING` | Blob storage | Vector backup |
| `VECTOR_INDEX_DISABLED` | Skip vector index build | Optional |
| `ENABLE_TEST_CREDS` | Enable test passwords | Dev only |
| `TEST_ACCOUNT_PASSWORD` | Shared test password | Dev only |
| `CORS_ORIGINS` | Allowed origins (CSV) | Default: localhost |
| `PORT` | Server port | Default: 5199 |
| `AUTO_SYNC_DISABLED` | Disable auto-sync | Optional |

---

## 10. Archived Code

See `server/archive/README.md`. The `server/archive/` directory contains older versions of the same modules from before the code was flattened from a layered structure (`core/`, `security/`, `controllers/`, `services/`) into the current flat `server/*.js` layout. **None of the archived files are imported by the active flow.**

```
