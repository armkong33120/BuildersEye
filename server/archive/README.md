# Archive — Stale Code

These files are **older versions** of modules that were refactored and flattened into `server/*.js` at the repository root. They are **not imported** by the current chat flow (`index.js` → `chatController.js`) or any active API route. They are preserved here for reference only.

## Why archived (not deleted)

The codebase underwent a reorganization where a layered directory structure (`core/`, `security/`, `controllers/`, `services/`) was flattened to a single-level `server/*.js` layout. The root-level copies are the **active** versions. These subdirectory copies are the **pre-flattening** originals.

## What each directory contains

### `core/` — Core RAG components (old)
| File | Active replacement |
|------|-------------------|
| `chunker.js` | `server/chunker.js` |
| `kvCache.js` | `server/responseCache.js` (redesigned) |
| `llmClient.js` | `server/llmClient.js` |
| `llmRerank.js` | `server/llmRerank.js` |
| `localEmbedder.js` | `server/localEmbedder.js` |
| `vectorStore.js` | `server/vectorStore.js` |

### `security/` — Policy & RBAC (old)
| File | Active replacement |
|------|-------------------|
| `anonymizer.js` | `server/anonymizer.js` |
| `intentParser.js` | `server/intentParser.js` |
| `policy.js` | `server/policy.js` |
| `pronounResolver.js` | `server/pronounResolver.js` |

### `controllers/` — API controllers (old)
| File | Active replacement |
|------|-------------------|
| `chatController.js` | `server/chatController.js` |
| `hybridSearch.js` | `server/hybridSearch.js` |
| `searchIndex.js` | `server/searchIndex.js` |
| `sheetAliases.js` | `server/sheetAliases.js` |
| `sqlEngine.js` | `server/sqlEngine.js` |

### `services/` — Domain services (old)
| File | Active replacement |
|------|-------------------|
| `agenticRag.js` | Removed (unused pattern) |
| `analyticsEngine.js` | `server/analyticsEngine.js` |
| `build-graph.js` | `server/build-graph.js` |
| `employeeRegistry.js` | `server/employeeRegistry.js` |
| `observability.js` | `server/appInsightsSetup.js` |
| `orgDocs.js` | `server/orgDocs.js` |

### `old-server-cache/` — Pre-refactor vector cache (~1.2 GB)
Old cached vector files (`vectors.json`, `vectors.jsonl`) from before the vector store was refactored. Safe to delete if disk space is needed — the active cache lives in `server/.cache/`.

## Notes
- Archived on: 2026-08-12
- The `services/` subdirectory also contained a `.data/registry/` path — this was an old local copy of the employee registry, now superseded by `server/.data/registry/`.
