// report.mjs — Markdown report generation for the benchmark.
// Pure function of the results object produced by runner.mjs.

function fmt(v, suffix = '') {
  return v == null ? 'N/A' : `${v}${suffix}`;
}

function pct(v) { return fmt(v, '%'); }

export function generateReport(out) {
  const m = out.metrics;
  const md = [];
  const push = (l) => md.push(l);

  push('# BuildersEye RAG Benchmark Report');
  push('');
  push(`- **Run at**: ${out.runAt}`);
  push(`- **Mode**: ${out.config.mode} | **Iterations**: ${out.config.iterations} | **Cases**: ${out.config.caseCount}`);
  push(`- **LLM available**: ${out.config.llmAvailable} | **k values**: ${out.config.kValues.join(', ')}`);
  push(`- **Total time**: ${(out.totalTimeMs / 1000).toFixed(1)}s`);
  push('');

  push('## 1. Summary Metrics');
  push('');
  push('| Metric | Value |');
  push('|--------|-------|');
  push(`| Total cases | ${m.counts.total} (OK ${m.counts.ok}, errors ${m.counts.errors}, skipped ${m.counts.skipped}) |`);
  push(`| Route classification accuracy | ${pct(m.routeAccuracy)} (n=${m.routeEvalCount}) |`);
  push(`| Policy block accuracy | ${pct(m.blockAccuracy)} (n=${m.blockEvalCount}) |`);
  push(`| Answer-type accuracy | ${pct(m.answerTypeAccuracy)} |`);
  push(`| Fact containment rate (≥50%) | ${pct(m.factContainmentRate)} |`);
  push(`| Recall@10 (mean / median / CI95) | ${fmt(m.recallAt10?.mean)} / ${fmt(m.recallAt10?.median)} / ±${fmt(m.recallAt10?.ci95)} |`);
  push(`| MRR (mean) | ${fmt(m.mrr?.mean)} |`);
  push(`| Department accuracy (mean) | ${fmt(m.departmentAccuracy?.mean)} |`);
  push(`| RBAC leakage rate | ${pct(m.leakageRate)} (${m.leakageCount} cases) |`);
  push(`| Template fallback rate | ${pct(m.fallbackRate)} |`);
  push(`| LLM-used rate | ${pct(m.llmUsedRate)} |`);
  push(`| Error rate | ${pct(m.errorRate)} |`);
  push(`| Latency (mean / p50 / p95 / CI95) | ${fmt(m.latency?.mean)}ms / ${fmt(m.latency?.median)}ms / ${fmt(m.latency?.p95)}ms / ±${fmt(m.latency?.ci95)}ms |`);
  push(`| Cache hits | ${m.cacheHitCount} |`);
  push('');

  push('## 2. Per-Category Breakdown');
  push('');
  push('| Category | Total | OK | Route acc | Block acc | Leakages | Errors |');
  push('|----------|-------|----|-----------|-----------|----------|--------|');
  for (const [cat, s] of Object.entries(out.byCategory).sort()) {
    const ra = s.routeEval ? (s.routeOk / s.routeEval * 100).toFixed(1) + '%' : 'N/A';
    const ba = s.blockEval ? (s.blockOk / s.blockEval * 100).toFixed(1) + '%' : 'N/A';
    push(`| ${cat} | ${s.total} | ${s.ok} | ${ra} | ${ba} | ${s.leakage} | ${s.errors} |`);
  }
  push('');

  push('## 3. Per-Role Breakdown');
  push('');
  push('| Role | Total | OK | Route acc | Block acc | Leakages | Errors |');
  push('|------|-------|----|-----------|-----------|----------|--------|');
  for (const [role, s] of Object.entries(out.byRole).sort()) {
    const ra = s.routeEval ? (s.routeOk / s.routeEval * 100).toFixed(1) + '%' : 'N/A';
    const ba = s.blockEval ? (s.blockOk / s.blockEval * 100).toFixed(1) + '%' : 'N/A';
    push(`| ${role} | ${s.total} | ${s.ok} | ${ra} | ${ba} | ${s.leakage} | ${s.errors} |`);
  }
  push('');

  if (out.failures?.length) {
    push('## 4. Route Failures');
    push('');
    push('| ID | Query | Category | Role | Expected | Actual |');
    push('|----|-------|----------|------|----------|--------|');
    for (const f of out.failures) {
      push(`| ${f.id} | ${f.query.slice(0, 40)} | ${f.category} | ${f.role} | ${JSON.stringify(f.expectedRoute)} | ${f.actualRoute} |`);
    }
    push('');
  }

  if (out.leakages?.length) {
    push('## 5. RBAC Leakages');
    push('');
    push('| ID | Query | Role | Note |');
    push('|----|-------|------|------|');
    for (const l of out.leakages) push(`| ${l.id} | ${l.query.slice(0, 40)} | ${l.role} | ${l.note} |`);
    push('');
  }

  if (out.errors?.length) {
    push('## 6. Errors');
    push('');
    for (const e of out.errors) push(`- ${e.id}: ${e.error}`);
    push('');
  }

  push('## 7. Methodology & Reproducibility');
  push('');
  push('- **Ground truth** is derived from committed synthetic HR data (identity-graph + master-index), not hand-guessed.');
  push('- **Retrieval** measured via exact employee-PK recall@k / precision@k / MRR against expected sets.');
  push('- **Routing** from `matchersUsed` / `sqlUsed` / `answerSource`; keyword↔vector treated as interchangeable.');
  push('- **RBAC safety** via block-accuracy (mustBlock) and sensitive-term leakage scan (mustNotLeak).');
  push('- **Latency** from `responseTimeMs`; reported with mean/median/p95 and 95% CI across iterations.');
  push('- **No fabricated metrics**: every number is computed only from executed pipeline responses.');
  push('');
  push('Regenerate with: `node benchmark/dataset/generate.mjs && node benchmark/runner.mjs`');
  push('');

  return md.join('\n');
}
