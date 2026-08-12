# BuildersEye RAG Evaluation Framework

## Overview

Reproducible RAG evaluation for the BuildersEye chat pipeline. Tests the end-to-end flow from query to answer, measuring retrieval quality, routing accuracy, RBAC enforcement, and latency.

## Quick Start

```bash
# DIRECT mode (loads modules, no server needed)
npm run eval:rag

# HTTP mode (against running backend)
npm run eval:rag -- --http

# Filter specific questions
npm run eval:rag -- --filter=q001,q026,q033

# Custom port (HTTP mode)
npm run eval:rag -- --http --port=5199
```

## Files

| File | Purpose |
|------|---------|
| `golden_questions.json` | 65 hand-crafted test questions |
| `run_eval.mjs` | Main evaluation script |
| `output/results.json` | Machine-readable JSON results |
| `output/report.md` | Human-readable Markdown report |

## Modes

### DIRECT Mode (default)
Imports `chatHandler` + all pipeline modules directly. No server needed.

- Loads data via Employee Registry or Excel ingest
- Initializes SQL engine (AlaSQL) in-memory
- Calls `chatHandler()` directly
- LLM-dependent tests SKIPPED if `LLM_API_KEY` unavailable

### HTTP Mode (`--http`)
Sends POST to `http://localhost:PORT/api/chat`. Requires backend running.

## Golden Dataset

65 questions across 8 categories, 3 viewer roles:

| Category | Count | Description |
|----------|-------|-------------|
| `factual_lookup` | 14 | Employee facts (EMP codes, departments, positions) |
| `keyword_retrieval` | 8 | Department membership, sheet category searches |
| `vector_retrieval` | 11 | Semantic/skill-based searches |
| `sql_analytics` | 24 | Aggregate queries (averages, counts, max/min) |
| `ambiguous` | 1 | Vague queries testing clarification |
| `blocked_policy` | 2 | Queries MUST be blocked for certain roles |
| `rbac_sensitive` | 4 | Same question, different roles |
| `sql_misclassification` | 1 | Regression: false-positive SQL routing |

Roles: CEO (49), HR (0), Manager (2), Employee (4)

## Evaluation Metrics

### Route Classification Accuracy
Percentage of queries routed to the expected path (keyword, vector, sql, blocked). Routes determined from `matchersUsed`, `sqlUsed`, `answerSource` in the response.

### Policy Block Accuracy
Correctly blocked vs allowed queries per RBAC rules in `policy.js`.

### Result Completeness
Percentage returning expected minimum results (`resultCount >= expectedMinResults`).

### SQL Misclassification Regression (q026)
Query "วิศวกรคนไหนทำ OT เทปูนข้ามคืน" contains "ปัญหา" which matches `needsSqlAnalytics` regex (`chatController.js:37`). This is a **false positive** — the query is about overtime, not problem analytics. Expected: route to keyword/vector, NOT SQL.

### RBAC Leakage Rate
Salary/compensation terms detected in answers when viewer lacks permission. Self-lookups allowed.

### Template Fallback Rate
Template (non-LLM) answer percentage. High rates indicate LLM unavailable or retrieval failure.

### Latency
Avg, P50, P95 end-to-end response times.

## Methodology

1. **Route Classification**: From `matchersUsed`, `sqlUsed`, `answerSource` in chat handler response.
2. **RBAC Leakage**: Keyword scans for salary/compensation terms when role is Employee/Manager.
3. **Blocked Detection**: Checks `policy.status === 'Blocked'`.
4. **SQL Misclassification**: Verifies q026 is NOT routed to SQL.
5. **LLM-Dependent Tests**: Skipped when `LLM_API_KEY` unavailable; deterministic tests still run.

## Limitations

1. **Recall@k/Precision@k** are approximated via result count, not exact PK matching.
2. **Answer Correctness** limited to deterministic checks; no LLM-as-judge.
3. **Vector Search** needs pre-built vector index (`server/.data/vectors/chunks.jsonl`).
4. **Pronoun/Follow-up** questions tested standalone (no conversation history simulation).
5. **Cache Hit** testing requires two sequential identical queries — not automated.

## Baseline Metrics (Expected)

| Metric | Target |
|--------|--------|
| Route Classification Accuracy | > 85% |
| Policy Block Accuracy | > 95% |
| SQL Misclassification (q026) | PASS |
| RBAC Leakage Rate | < 5% |
| Template Fallback Rate | < 30% |
| Avg Latency | < 2000ms |

## Known Issues

### SQL Misclassification (chatController.js:37)
The `needsSqlAnalytics` regex includes `ปัญหา` which catches OT/construction queries.

**Impact**: Queries about concrete pouring OT route to SQL, generating irrelevant results.

**Fix Options**:
1. Narrow the regex or add exclusion for OT/construction terms
2. Make SQL routing depend on semantic parser output (`TEXT_TO_SQL` intent) instead of regex only

## Adding New Test Questions

Add to `golden_questions.json`:

```json
{
  "id": "q066",
  "query": "Your Thai question",
  "category": "factual_lookup|keyword_retrieval|vector_retrieval|sql_analytics|ambiguous|blocked_policy|rbac_sensitive|sql_misclassification",
  "expectedRoute": "keyword|vector|sql|blocked",
  "expectedMinResults": 0,
  "expectedBlocked": false,
  "rbacRole": "CEO|HR|Manager|Employee",
  "description": "What this tests"
}
```

Optional: `expectedNotRoute` to assert a route is NOT used (e.g., `"expectedNotRoute": "sql"`).