# BuildersEye RAG Evaluation Report

**Generated:** 2026-08-12T14:44:07.427Z
**Mode:** direct
**LLM Available:** Yes
**Total Time:** 16061ms

## 1. Summary
| Metric | Value |
|--------|-------|
| Total Questions | 1 |
| OK | 1 |
| Errors | 0 |
| Blocked (by policy) | 0 |
| Skipped (LLM unavailable) | 0 |

## 2. Core Scores
| Metric | Score |
|--------|-------|
| Route Classification Accuracy | 0.0% |
| Policy Block Accuracy | 100.0% |
| Result Completeness Rate | 0.0% |
| SQL Misclassification (q026) | **FAIL** |
| RBAC Leakage Rate | 0.0% |
| Template Fallback Rate | 0.0% |
| Avg Latency | 16060ms |
| P50 Latency | 16060ms |
| P95 Latency | 16060ms |

## 3. By Category
| Category | Total | Route OK | Block OK | Result OK | Errors | Skipped |
|----------|-------|----------|----------|-----------|--------|--------|
| sql_misclassification | 1 | 0 | 1 | 0 | 0 | 0 |

## 4. By Role
| Role | Total | Route OK | Block OK | RBAC Leakages |
|------|-------|----------|----------|---------------|
| CEO | 1 | 0 | 1 | 0 |

## 5. SQL Misclassification Regression (q026)
> Query "วิศวกรคนไหนทำ OT เทปูนข้ามคืน" contains "ปัญหา" triggering SQL regex.
> Expected: NOT routed to SQL. This is a FALSE POSITIVE for OT/construction queries.

| q026 | sqlUsed=true | route=sql | FAIL ❌ | REGRESSION: sqlUsed=true, route=sql — FAIL: incorrect SQL routing |

## 9. Methodology
- **Route classification**: determined from matchersUsed, sqlUsed, answerSource in response.
- **RBAC leakage**: keyword scans of answer for salary/compensation terms when viewer lacks permission.
- **Latency**: end-to-end from query to response.
- **SQL misclassification regression (q026)**: tests false-positive trigger of "ปัญหา" in SQL regex.
- **LLM-dependent tests**: sql_analytics, vector_retrieval queries SKIPPED when LLM_API_KEY unavailable.
