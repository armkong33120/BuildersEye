// generate.mjs — Build the full benchmark dataset deterministically.
// Dataset = cases.hand.json (hand-authored tricky categories) + programmatic
// cases derived from the committed synthetic HR data (ground truth is exact).
// Output: benchmark/dataset/cases.json. Run: node benchmark/dataset/generate.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  departmentNames, employeesInDept, employeeByPk,
  nameOf, factFor, validateCase,
} from '../lib/groundTruth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HAND_PATH = path.join(__dirname, 'cases.hand.json');
const OUT_PATH = path.join(__dirname, 'cases.json');

const SAMPLE_PKS = [1, 2, 3, 5, 10, 35, 42, 50, 63, 100, 120, 135, 143, 147, 150];

const cases = [];
let seq = 1;
const push = (c) => cases.push({ id: 'bench-' + String(seq++).padStart(3, '0'), ...c });

// ── 1. Direct factual lookup (EMP code → position) ──────────────────────────
for (const pk of SAMPLE_PKS) {
  const e = employeeByPk(pk);
  push({
    query: `EMP${String(pk).padStart(3, '0')} ทำงานตำแหน่งอะไร`,
    language: 'th', category: 'factual', role: 'CEO',
    expectedRoute: ['exact-employee', 'keyword'], expectedAnswerType: 'grounded',
    expectedEmployeeIds: [pk], expectedDepartments: e ? [e.department] : [], expectedSources: [pk],
    mustBlock: false, mustNotLeak: false,
    expectedFacts: e?.currentPosition ? [e.currentPosition] : [], acceptableAnswers: [],
    notes: 'generated: EMP code → position',
  });
}

// ── 3. Department lookup (membership for every department) ─────────────────
for (const dept of departmentNames()) {
  const pks = employeesInDept(dept);
  push({
    query: `ใครอยู่ในฝ่าย ${dept} บ้าง`,
    language: 'th', category: 'department', role: 'CEO',
    expectedRoute: ['keyword', 'vector'], expectedAnswerType: 'grounded',
    expectedEmployeeIds: pks.slice(0, 6), expectedDepartments: [dept], expectedSources: [],
    mustBlock: false, mustNotLeak: false,
    expectedFacts: [], acceptableAnswers: [],
    notes: `generated: department membership (${pks.length} members)`,
  });
}

// ── 2. Employee profile lookup (KPI / level / band) ─────────────────────────
const PROFILE_FIELDS = [
  ['latestKpiScore', 'KPI', (v) => String(v)],
  ['level', 'ระดับตำแหน่ง', (v) => String(v)],
  ['performanceBand', 'performance band', (v) => String(v)],
];
for (const pk of [1, 10, 42, 135, 147]) {
  for (const [field, label, fmt] of PROFILE_FIELDS) {
    const val = factFor(pk, field);
    push({
      query: `${label} ของ EMP${String(pk).padStart(3, '0')} คืออะไร`,
      language: 'th', category: 'profile', role: 'CEO',
      expectedRoute: ['exact-employee', 'keyword', 'sql'], expectedAnswerType: 'grounded',
      expectedEmployeeIds: [pk], expectedDepartments: [employeeByPk(pk)?.department], expectedSources: [pk],
      mustBlock: false, mustNotLeak: false,
      expectedFacts: val != null ? [fmt(val)] : [], acceptableAnswers: [],
      notes: `generated: profile field ${field}`,
    });
  }
}

// ── 4. Keyword retrieval (job title → employee) ─────────────────────────────
const TITLE_CASES = [
  [3, 'CFO', 'ใครคือ CFO'],
  [2, 'COO', 'ใครเป็น COO'],
  [135, 'HR Manager', 'ใครเป็น HR Manager'],
  [143, 'IT Manager', 'ใครคือ IT Manager'],
  [147, 'Legal Manager', 'Legal Manager คือใคร'],
  [5, 'Head of Construction', 'ใครคือ Head of Construction'],
  [42, 'Graphic Designer', 'ใครเป็น Graphic Designer'],
  [150, 'Executive Driver', 'Executive Driver คือใคร'],
];
for (const [pk, title, query] of TITLE_CASES) {
  push({
    query, language: query.match(/[a-zA-Z]/) ? 'mixed' : 'th', category: 'keyword', role: 'CEO',
    expectedRoute: ['keyword', 'vector'], expectedAnswerType: 'grounded',
    expectedEmployeeIds: [pk], expectedDepartments: [employeeByPk(pk)?.department], expectedSources: [pk],
    mustBlock: false, mustNotLeak: false,
    expectedFacts: nameOf(pk) ? [nameOf(pk)] : [], acceptableAnswers: [],
    notes: `generated: job title "${title}"`,
  });
}

// ── 6. SQL analytics (aggregates over HR data) ──────────────────────────────
const SQL_CASES = [
  ['เงินเดือนเฉลี่ยของพนักงานฝ่าย IT', 'IT', 'avg salary of IT'],
  ['KPI เฉลี่ยของฝ่ายขาย', 'Sales', 'avg KPI of sales'],
  ['จำนวนพนักงานทั้งหมดในบริษัท', null, 'total headcount'],
  ['ใครมี KPI สูงสุด', null, 'max KPI'],
  ['โบนัสเฉลี่ยของพนักงานทุกคน', null, 'avg bonus'],
  ['กี่คนที่มี KPI มากกว่า 3.5', null, 'count KPI > 3.5'],
  ['เงินเดือนต่ำสุดในบริษัท', null, 'min salary'],
  ['Base salary ของ CEO', 'Executive', 'CEO base salary'],
];
for (const [query, dept, note] of SQL_CASES) {
  push({
    query, language: query.match(/[a-zA-Z]/) ? 'mixed' : 'th', category: 'sql_analytics', role: 'CEO',
    expectedRoute: ['sql'], expectedAnswerType: 'sql',
    expectedEmployeeIds: [], expectedDepartments: dept ? [dept] : [], expectedSources: [],
    mustBlock: false, mustNotLeak: false,
    expectedFacts: [], acceptableAnswers: [], notes: 'generated: ' + note,
  });
}

// ── 7. Aggregation and comparison ───────────────────────────────────────────
const AGG_CASES = [
  'แผนกไหนมีกำไรสูงสุด',
  'แผนกไหนมีพนักงานมากที่สุด',
  'เทียบ KPI ระหว่างฝ่าย IT กับฝ่าย Legal',
  'แผนกไหน net profit ติดลบ',
  'แผนกไหน profit margin สูงสุด',
  'เปรียบเทียบเงินเดือนเฉลี่ย Sales กับ Marketing',
  'จำนวน warning สูงสุดคือของใคร',
  'ฝ่ายไหนมี revenue ต่ำสุด',
  'แผนกไหนมี headcount cost สูงสุด',
  'เทียบ KPI ของ CFO กับ COO',
];
for (const query of AGG_CASES) {
  push({
    query, language: query.match(/[a-zA-Z]/) ? 'mixed' : 'th', category: 'aggregation', role: 'CEO',
    expectedRoute: ['sql'], expectedAnswerType: 'sql',
    expectedEmployeeIds: [], expectedDepartments: [], expectedSources: [],
    mustBlock: false, mustNotLeak: false,
    expectedFacts: [], acceptableAnswers: [], notes: 'generated: aggregation/comparison',
  });
}

// ── 10. Missing-data (non-existent employees/depts) ─────────────────────────
const MISSING_CASES = [
  ['EMP999 คือใคร', 'EMP code out of range'],
  ['ใครคือพนักงาน EMP200', 'EMP code out of range'],
  ['แผนก Quantum Computing มีใครบ้าง', 'non-existent department'],
  ['KPI ของ EMP999 เท่าไหร่', 'profile of non-existent employee'],
  ['ใครชื่อ Albert Einstein', 'non-existent name'],
  ['ตำแหน่งของ EMP000 คืออะไร', 'invalid EMP code'],
];
for (const [query, note] of MISSING_CASES) {
  push({
    query, language: query.match(/[a-zA-Z]/) ? 'mixed' : 'th', category: 'missing_data', role: 'CEO',
    expectedRoute: ['keyword', 'vector', 'exact-employee'], expectedAnswerType: 'grounded',
    expectedEmployeeIds: [], expectedDepartments: [], expectedSources: [],
    mustBlock: false, mustNotLeak: false,
    expectedFacts: [], acceptableAnswers: [], notes: 'generated: ' + note,
  });
}



export function generateCases() {
  let hand = [];
  try { hand = JSON.parse(fs.readFileSync(HAND_PATH, 'utf-8')); }
  catch (e) { console.warn('[generate] hand-authored cases missing:', e.message); }
  const combined = [...cases, ...hand];
  combined.forEach((c, i) => { c.id = 'bench-' + String(i + 1).padStart(3, '0'); });
  return combined;
}

export function validateDataset(list) {
  const issues = [];
  const seen = new Set();
  for (const c of list) {
    if (seen.has(c.id)) issues.push(`duplicate id ${c.id}`);
    seen.add(c.id);
    for (const issue of validateCase(c)) issues.push(`${c.id}: ${issue}`);
  }
  return issues;
}

const CATEGORY_MIN = {
  factual: 1, profile: 1, department: 1, keyword: 1, vector: 1, sql_analytics: 1,
  aggregation: 1, ambiguous: 1, pronoun: 1, missing_data: 1, cache_hit: 1,
  blocked_policy: 1, rbac_sensitive: 1, thai: 1, mixed: 1, adversarial: 1,
  sql_fallback: 1, out_of_domain: 1,
};

export function checkCoverage(list) {
  const counts = {};
  for (const c of list) counts[c.category] = (counts[c.category] || 0) + 1;
  const missing = Object.keys(CATEGORY_MIN).filter((k) => !(counts[k] >= CATEGORY_MIN[k]));
  return { counts, missing };
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const list = generateCases();
  const issues = validateDataset(list);
  const { counts, missing } = checkCoverage(list);
  console.log(`[generate] ${list.length} total cases`);
  console.log('[generate] category coverage:', JSON.stringify(counts));
  if (missing.length) console.log('[generate] WARNING missing categories:', missing.join(', '));
  if (issues.length) {
    console.error('[generate] validation issues:');
    for (const i of issues) console.error('  -', i);
    process.exit(1);
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(list, null, 2), 'utf-8');
  console.log(`[generate] wrote ${OUT_PATH}`);
}
