# BuildersEye RAG Benchmark

A reproducible, statistically meaningful benchmark for the BuildersEye RAG
pipeline. It measures more than "the API returned 200" — retrieval quality,
answer quality, routing, RBAC safety, latency, reliability, and caching across
multiple user roles and query types.

## Quick Start

```bash
# Regenerate the dataset (derives ground truth from committed HR data)
npm run benchmark:generate

# Full run (DIRECT mode — imports chatHandler, no server needed)
npm run benchmark

# HTTP mode (against a running backend)
npm run benchmark -- --http --port=5199

# Subsets
npm run benchmark -- --category=sql_analytics
npm run benchmark -- --filter=bench-001,bench-010
npm run benchmark -- --iterations=1          # fast smoke run
```

## Dataset (154 cases · 18 categories)

| Category | Count | What it measures |
|----------|-------|------------------|
| factual | 15 | EMP code → name/position/dept |
| profile | 15 | KPI / level / band lookups |
| department | 12 | department membership |
| keyword | 8 | job-title / field retrieval |
| vector | 10 | semantic (meaning) retrieval |
| sql_analytics | 8 | aggregate queries |
| aggregation | 10 | comparison / ranking |
| ambiguous | 6 | clarification handling |
| pronoun | 8 | follow-up / pronoun resolution |
| missing_data | 6 | no-result behavior |
| cache_hit | 4 | repeated-query caching (cold+warm) |
| blocked_policy | 8 | policy block enforcement |
| rbac_sensitive | 6 | cross-role scope/redaction |
| thai | 10 | Thai-language queries |
| mixed | 8 | Thai-English technical queries |
| adversarial | 8 | misleading / fishing queries |
| sql_fallback | 6 | SQL-regex false-positive routing |
| out_of_domain | 6 | unrelated queries |

Each case carries structured metadata (`expectedEmployeeIds`,
`expectedDepartments`, `expectedFacts`, `mustBlock`, `mustNotLeak`, …).
**Ground truth is derived from the committed synthetic HR data**
(`src/data/identity-graph.json` + `master-index.json`), never hand-guessed.

## Metrics

| Family | Metrics |
|--------|---------|
| Retrieval quality | recall@k, precision@k, MRR, department accuracy, source coverage |
| Routing | route-classification accuracy (per category & role) |
| Answer quality | answer-type accuracy, fact containment |
| RBAC safety | block accuracy, leakage rate, scope containment |
| Latency | mean / p50 / p95 / 95% CI |
| Reliability | error rate, template-fallback rate, LLM-used rate |
| Caching | cache-hit count (cold+warm correctness) |
| Statistical | mean / median / stddev / 95% CI across N iterations |

**No fabricated metrics** — every number is computed only from executed
pipeline responses. If a measurement cannot be made (e.g. vector index absent),
it is recorded as `null`/`skipped`, never invented.

## Files

| File | Purpose |
|------|---------|
| `dataset/cases.hand.json` | hand-authored tricky cases |
| `dataset/generate.mjs` | deterministic case generator (data-derived) |
| `dataset/cases.json` | generated single source of truth |
| `lib/groundTruth.mjs` | ground-truth lookup + validation |
| `lib/metrics.mjs` | per-case + aggregate metric computation |
| `lib/stats.mjs` | mean/percentile/CI helpers |
| `runner.mjs` | execution (DIRECT + HTTP, N iterations) |
| `report.mjs` | Markdown report generation |
| `config.json` | iterations, k-values, role mapping, thresholds |
| `output/` | `results.json` + `report.md` |

## Known Findings (measured by this benchmark)

- **SQL regex false-positives** (`sql_fallback`): queries containing `ปัญหา`,
  `ความเสี่ยง`, `จุดอ่อน` trigger the `needsSqlAnalytics` regex and misroute to
  SQL. The pipeline has a fallback (SQL error → keyword/vector), so answers are
  preserved but routing accuracy is affected.
- **Thai `โบนัส` (bonus) is not policy-blocked**: the block regex lists English
  `bonus` but not Thai `โบนัส`, so an Employee asking `โบนัสของ CEO` is not
  blocked. The benchmark's `blocked_policy` cases use `เงินเดือน` (which IS
  blocked) as the baseline; this gap is a candidate for a policy fix.

## Reproducibility

The dataset is deterministic (data-derived) and the runner supports N
iterations with fixed seeds. `results.json` includes the run timestamp, mode,
iteration count, and LLM availability. Regenerate and re-run anytime:

```bash
node benchmark/dataset/generate.mjs && node benchmark/runner.mjs
```
