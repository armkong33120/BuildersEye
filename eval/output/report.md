# BuildersEye RAG Evaluation Report

**Generated:** 2026-08-12T06:27:03.586Z
**Mode:** direct
**LLM Available:** No (LLM-dependent tests SKIPPED)
**Total Time:** 4345ms

## 1. Summary
| Metric | Value |
|--------|-------|
| Total Questions | 65 |
| OK | 65 |
| Errors | 0 |
| Blocked (by policy) | 3 |
| Skipped (LLM unavailable) | 39 |

## 2. Core Scores
| Metric | Score |
|--------|-------|
| Route Classification Accuracy | 100.0% |
| Policy Block Accuracy | 100.0% |
| Result Completeness Rate | 95.7% |
| SQL Misclassification (q026) | **PASS** |
| RBAC Leakage Rate | 0.0% |
| Template Fallback Rate | 88.5% |
| Avg Latency | 70ms |
| P50 Latency | 9ms |
| P95 Latency | 18ms |

## 3. By Category
| Category | Total | Route OK | Block OK | Result OK | Errors | Skipped |
|----------|-------|----------|----------|-----------|--------|--------|
| factual_lookup | 12 | 12 | 12 | 12 | 0 | 0 |
| keyword_retrieval | 6 | 6 | 6 | 6 | 0 | 0 |
| sql_analytics | 29 | 0 | 29 | 29 | 0 | 29 |
| vector_retrieval | 10 | 10 | 10 | 10 | 0 | 10 |
| ambiguous | 1 | 1 | 1 | 1 | 0 | 0 |
| sql_misclassification | 1 | 1 | 1 | 0 | 0 | 0 |
| rbac_sensitive | 4 | 4 | 4 | 4 | 0 | 0 |
| blocked_policy | 2 | 2 | 2 | 2 | 0 | 0 |

## 4. By Role
| Role | Total | Route OK | Block OK | RBAC Leakages |
|------|-------|----------|----------|---------------|
| CEO | 61 | 32 | 61 | 0 |
| Employee | 3 | 3 | 3 | 0 |
| Manager | 1 | 1 | 1 | 0 |

## 5. SQL Misclassification Regression (q026)
> Query "วิศวกรคนไหนทำ OT เทปูนข้ามคืน" contains "ปัญหา" triggering SQL regex.
> Expected: NOT routed to SQL. This is a FALSE POSITIVE for OT/construction queries.

| q026 | sqlUsed=false | route=keyword | PASS ✅ | REGRESSION: sqlUsed=false, route=keyword |

## 8. Skipped (LLM Unavailable)
- q008: LLM key unavailable
- q009: LLM key unavailable
- q010: LLM key unavailable
- q011: LLM key unavailable
- q012: LLM key unavailable
- q013: LLM key unavailable
- q014: LLM key unavailable
- q015: LLM key unavailable
- q019: LLM key unavailable
- q020: LLM key unavailable
- q022: LLM key unavailable
- q024: LLM key unavailable
- q025: LLM key unavailable
- q027: LLM key unavailable
- q028: LLM key unavailable
- q029: LLM key unavailable
- q030: LLM key unavailable
- q032: LLM key unavailable
- q038: LLM key unavailable
- q039: LLM key unavailable
- q040: LLM key unavailable
- q041: LLM key unavailable
- q042: LLM key unavailable
- q044: LLM key unavailable
- q046: LLM key unavailable
- q048: LLM key unavailable
- q049: LLM key unavailable
- q050: LLM key unavailable
- q052: LLM key unavailable
- q053: LLM key unavailable
- q054: LLM key unavailable
- q055: LLM key unavailable
- q057: LLM key unavailable
- q058: LLM key unavailable
- q059: LLM key unavailable
- q060: LLM key unavailable
- q062: LLM key unavailable
- q063: LLM key unavailable
- q064: LLM key unavailable

## 9. Methodology
- **Route classification**: determined from matchersUsed, sqlUsed, answerSource in response.
- **RBAC leakage**: keyword scans of answer for salary/compensation terms when viewer lacks permission.
- **Latency**: end-to-end from query to response.
- **SQL misclassification regression (q026)**: tests false-positive trigger of "ปัญหา" in SQL regex.
- **LLM-dependent tests**: sql_analytics, vector_retrieval queries SKIPPED when LLM_API_KEY unavailable.
