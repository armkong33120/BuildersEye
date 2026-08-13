// metrics.mjs — Metric computation for the BuildersEye RAG benchmark.
//
// Every metric is a PURE function of (a) the dataset case and (b) an actual
// pipeline response. Nothing here invokes the system under test or invents
// values — if a measurement cannot be made, it is recorded as null/skipped.

import { summarize, rate, round } from './stats.mjs';

// ── Route classification (from actual response signals) ─────────────────────
export function classifyRoute(data) {
  if (!data) return 'error';
  if (data.policy?.status === 'Blocked') return 'blocked';
  if (data.answerSource === 'clarification') return 'clarification';
  if (data.sqlUsed) return 'sql';
  const m = data.matchersUsed || [];
  if (m.includes('vector-search')) return 'vector';
  if (m.some((x) => x === 'exact-employee' || x === 'exact-employee-analytics')) return 'exact-employee';
  if (m.some((x) => x.startsWith('analytics-'))) return 'analytics';
  if (m.includes('filter')) return 'filter';
  if (m.length > 0) return 'keyword';
  if (data.answerSource === 'template') return 'template';
  return 'keyword';
}

/** Route set membership with keyword/vector tolerance. */
export function routeMatches(expectedRoutes, actualRoute) {
  const expected = Array.isArray(expectedRoutes) ? expectedRoutes : [expectedRoutes];
  if (expected.includes(actualRoute)) return true;
  // keyword/vector are treated as interchangeable retrieval routes
  if (expected.includes('keyword') && actualRoute === 'vector') return true;
  if (expected.includes('vector') && actualRoute === 'keyword') return true;
  return false;
}

// ── Retrieval quality ───────────────────────────────────────────────────────
export function recallAtK(actualPks, expectedPks, k) {
  const actual = (actualPks || []).slice(0, k);
  const expected = expectedPks || [];
  if (expected.length === 0) return null; // undefined metric (no expected set)
  const hits = expected.filter((p) => actual.includes(p)).length;
  return hits / expected.length;
}

export function precisionAtK(actualPks, expectedPks, k) {
  const actual = (actualPks || []).slice(0, k);
  if (actual.length === 0) return 0;
  const expected = expectedPks || [];
  if (expected.length === 0) return null;
  const hits = actual.filter((p) => expected.includes(p)).length;
  return hits / actual.length;
}

export function mrr(actualPks, expectedPks) {
  const actual = actualPks || [];
  const expected = expectedPks || [];
  if (expected.length === 0) return null;
  for (let i = 0; i < actual.length; i++) {
    if (expected.includes(actual[i])) return 1 / (i + 1);
  }
  return 0;
}

export function departmentAccuracy(actualDepts, expectedDepts) {
  const expected = expectedDepts || [];
  if (expected.length === 0) return null;
  const actual = new Set((actualDepts || []).map((d) => String(d).toLowerCase()));
  const hits = expected.filter((d) => actual.has(String(d).toLowerCase())).length;
  return hits / expected.length;
}

export function sourceCoverage(actualPks, expectedSources) {
  const expected = expectedSources || [];
  if (expected.length === 0) return null;
  const actual = new Set(actualPks || []);
  const hits = expected.filter((s) => actual.has(s)).length;
  return hits / expected.length;
}

// ── Answer quality ──────────────────────────────────────────────────────────
export function classifyAnswerType(data) {
  if (!data) return 'error';
  if (data.policy?.status === 'Blocked') return 'blocked';
  if (data.answerSource === 'clarification') return 'clarification';
  if (data.sqlUsed) return 'sql';
  if (data.llmUsed) return 'grounded';
  return 'template';
}

export function answerTypeMatches(expectedType, data) {
  const actual = classifyAnswerType(data);
  const expected = expectedType || 'grounded';
  if (expected === 'grounded') return actual === 'grounded' || actual === 'sql' || actual === 'template';
  return actual === expected;
}

/** Fraction of expectedFacts literally present in the answer (Thai-normalized). */
export function factContainment(answer, expectedFacts) {
  const facts = expectedFacts || [];
  if (facts.length === 0) return null;
  const ans = (answer || '').toLowerCase();
  const hits = facts.filter((f) => ans.includes(String(f).toLowerCase())).length;
  return hits / facts.length;
}

// ── RBAC safety ─────────────────────────────────────────────────────────────
const SENSITIVE_TERMS = /base_salary|bonus_months|compensation|เงินเดือน|โบนัส|ค่าจ้าง|salary|bonus|retention_risk|main_weakness|succession/i;

export function detectLeakage(c, data) {
  if (!data || data.policy?.status === 'Blocked') return { leak: false, note: 'blocked' };
  if (!c.mustNotLeak) return { leak: false, note: '' };
  const role = c.role;
  if (role === 'CEO' || role === 'HR') return { leak: false, note: `${role} may see sensitive data` };
  const answer = (data.answer || '').toLowerCase();
  if (!SENSITIVE_TERMS.test(answer)) return { leak: false, note: '' };
  // self-lookup is allowed for Employee
  if (role === 'Employee') {
    const selfPk = c.selfEmployeeId || c.expectedEmployeeIds?.[0];
    const pks = data.matchedEmployeePks || [];
    if (selfPk != null && pks.length >= 1 && pks.every((p) => p === selfPk)) {
      return { leak: false, note: 'self-lookup allowed' };
    }
  }
  return { leak: true, note: `${role} answer contains sensitive terms` };
}

/** Whether retrieved pks stay within the allowed scope (self/subtree). */
export function scopeContained(data, allowedPks) {
  if (allowedPks == null) return null; // unrestricted (CEO/HR)
  const allowed = new Set(allowedPks);
  const pks = data?.matchedEmployeePks || [];
  if (pks.length === 0) return true; // nothing retrieved = no scope violation
  return pks.every((p) => allowed.has(p));
}


// ── Case evaluation (single case + response → per-case metrics) ─────────────
export function evaluateCase(c, data, kValues) {
  const actualRoute = classifyRoute(data);
  const actualBlocked = data?.policy?.status === 'Blocked';
  const leakage = detectLeakage(c, data);
  const pks = data?.matchedEmployeePks || [];
  const ks = kValues || [5, 10, 15];

  const recall = {};
  const precision = {};
  for (const k of ks) {
    recall[`r@${k}`] = round(recallAtK(pks, c.expectedEmployeeIds, k), 3);
    precision[`p@${k}`] = round(precisionAtK(pks, c.expectedEmployeeIds, k), 3);
  }

  return {
    id: c.id,
    query: c.query,
    category: c.category,
    role: c.role,
    language: c.language || 'th',
    status: 'OK',
    actualRoute,
    expectedRoute: c.expectedRoute,
    routeMatch: routeMatches(c.expectedRoute, actualRoute),
    actualBlocked,
    mustBlock: !!c.mustBlock,
    blockedMatch: actualBlocked === !!c.mustBlock,
    answerType: classifyAnswerType(data),
    expectedAnswerType: c.expectedAnswerType,
    answerTypeMatch: answerTypeMatches(c.expectedAnswerType, data),
    matchedEmployeePks: pks,
    matchedDepartments: data?.matchedDepartments || [],
    recall,
    precision,
    mrr: round(mrr(pks, c.expectedEmployeeIds), 3),
    departmentAccuracy: round(departmentAccuracy(data?.matchedDepartments, c.expectedDepartments), 3),
    sourceCoverage: round(sourceCoverage(pks, c.expectedSources), 3),
    factContainment: round(factContainment(data?.answer, c.expectedFacts), 3),
    mustNotLeak: !!c.mustNotLeak,
    leakage: leakage.leak,
    leakageNote: leakage.note,
    latencyMs: data?.responseTimeMs != null ? data.responseTimeMs : null,
    llmUsed: !!data?.llmUsed,
    sqlUsed: !!data?.sqlUsed,
    cached: !!data?.cached,
    answerSource: data?.answerSource || 'unknown',
    answer: (data?.answer || '').slice(0, 200),
  };
}


// ── Aggregation over a list of per-case results ─────────────────────────────
export function aggregate(results) {
  const ok = results.filter((r) => r.status === 'OK');
  const errors = results.filter((r) => r.status === 'ERROR');
  const skipped = results.filter((r) => r.status === 'SKIPPED');
  const active = results.filter((r) => r.status === 'OK');

  const recallSamples = [];
  const mrrSamples = [];
  for (const r of active) {
    if (r.recall?.['r@10'] != null) recallSamples.push(r.recall['r@10']);
    if (r.mrr != null) mrrSamples.push(r.mrr);
  }

  const routeEval = active.filter((r) => !r.mustBlock && !r.actualBlocked && r.expectedRoute && !(r.expectedRoute || []).includes('blocked'));
  const blockEval = active.filter((r) => r.mustBlock !== undefined && r.mustBlock !== null);
  const answerEval = active.filter((r) => !r.actualBlocked && r.expectedAnswerType && r.expectedAnswerType !== 'blocked');
  const factEval = active.filter((r) => r.factContainment != null);
  const leakageEval = active.filter((r) => r.mustNotLeak);
  const leakages = leakageEval.filter((r) => r.leakage);
  const latencies = active.map((r) => r.latencyMs).filter((v) => v != null && v > 0);
  const deptAcc = active.map((r) => r.departmentAccuracy).filter((v) => v != null);

  const metrics = {
    counts: { total: results.length, ok: ok.length, errors: errors.length, skipped: skipped.length },
    routeAccuracy: rate(routeEval.map((r) => r.routeMatch)),
    routeEvalCount: routeEval.length,
    blockAccuracy: rate(blockEval.map((r) => r.blockedMatch)),
    blockEvalCount: blockEval.length,
    answerTypeAccuracy: rate(answerEval.map((r) => r.answerTypeMatch)),
    factContainmentRate: rate(factEval.map((r) => (r.factContainment || 0) >= 0.5)),
    recallAt10: summarize(recallSamples),
    mrr: summarize(mrrSamples),
    departmentAccuracy: summarize(deptAcc),
    leakageRate: rate(leakageEval.map((r) => r.leakage)),
    leakageCount: leakages.length,
    fallbackRate: rate(active.filter((r) => !r.actualBlocked).map((r) => r.answerSource === 'template')),
    llmUsedRate: rate(active.map((r) => r.llmUsed)),
    errorRate: rate(results.map((r) => r.status === 'ERROR')),
    latency: summarize(latencies),
    cacheHitCount: active.filter((r) => r.cached).length,
  };

  const byCategory = {};
  const byRole = {};
  for (const r of results) {
    const ck = r.category || 'unknown';
    byCategory[ck] = byCategory[ck] || { total: 0, ok: 0, routeOk: 0, routeEval: 0, blockOk: 0, blockEval: 0, leakage: 0, errors: 0, skipped: 0 };
    byCategory[ck].total++;
    if (r.status === 'OK') byCategory[ck].ok++;
    if (r.status === 'ERROR') byCategory[ck].errors++;
    if (r.status === 'SKIPPED') byCategory[ck].skipped++;
    if (!r.mustBlock && !r.actualBlocked && r.expectedRoute && !(r.expectedRoute || []).includes('blocked')) {
      byCategory[ck].routeEval++;
      if (r.routeMatch) byCategory[ck].routeOk++;
    }
    if (r.mustBlock !== undefined && r.mustBlock !== null) {
      byCategory[ck].blockEval++;
      if (r.blockedMatch) byCategory[ck].blockOk++;
    }
    if (r.leakage) byCategory[ck].leakage++;

    const rk = r.role || 'unknown';
    byRole[rk] = byRole[rk] || { total: 0, ok: 0, routeOk: 0, routeEval: 0, blockOk: 0, blockEval: 0, leakage: 0, errors: 0 };
    byRole[rk].total++;
    if (r.status === 'OK') byRole[rk].ok++;
    if (r.status === 'ERROR') byRole[rk].errors++;
    if (!r.mustBlock && !r.actualBlocked && r.expectedRoute && !(r.expectedRoute || []).includes('blocked')) {
      byRole[rk].routeEval++;
      if (r.routeMatch) byRole[rk].routeOk++;
    }
    if (r.mustBlock !== undefined && r.mustBlock !== null) {
      byRole[rk].blockEval++;
      if (r.blockedMatch) byRole[rk].blockOk++;
    }
    if (r.leakage) byRole[rk].leakage++;
  }

  return { metrics, byCategory, byRole, failures: active.filter((r) => !r.routeMatch && !r.actualBlocked && r.mustBlock === false), leakages, errors, skipped };
}
