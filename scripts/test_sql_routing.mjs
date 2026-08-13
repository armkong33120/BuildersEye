// test_sql_routing.mjs — SQL routing regression tests.
// Verifies qualitative terms (ปัญหา / ความเสี่ยง / จุดอ่อน) do NOT trigger SQL,
// while genuine analytics queries still do.
// Usage: node scripts/test_sql_routing.mjs
import { detectSqlAnalyticsIntent, isQualitativeQuery } from '../server/sqlRouting.js';

const tests = [
  // qualitative → must NOT route to SQL
  ['วิศวกรคนไหนทำ OT เทปูนข้ามคืน', false],
  ['ปัญหาการทำงานของทีม IT', false],
  ['ความเสี่ยงของโครงการก่อสร้าง', false],
  ['จุดอ่อนของพนักงานฝ่ายขาย', false],
  // genuine analytics → must route to SQL
  ['กี่คนที่ KPI ต่ำ', true],
  ['เงินเดือนเฉลี่ยของแผนก Sales', true],
  ['เทียบ KPI ของ CFO กับ COO', true],
  ['รายได้รวมของแต่ละแผนก', true],
  ['โบนัสเฉลี่ยของพนักงานทุกคน', true],
];

let passed = 0, failed = 0;
for (const [query, expected] of tests) {
  const got = detectSqlAnalyticsIntent(query);
  const ok = got === expected;
  if (ok) { passed++; console.log(`  ✅ "${query}" → sql=${got}`); }
  else { failed++; console.log(`  ❌ "${query}" → sql=${got}, expected ${expected}`); }
}
// qualitative helper sanity
for (const q of ['ปัญหาการทำงานของทีม IT', 'ความเสี่ยงของโครงการก่อสร้าง', 'จุดอ่อนของพนักงานฝ่ายขาย']) {
  const ok = isQualitativeQuery(q) === true;
  if (ok) { passed++; console.log(`  ✅ isQualitative("${q}")=true`); }
  else { failed++; console.log(`  ❌ isQualitative("${q}") should be true`); }
}
console.log(`\n📊 SQL routing tests: ${passed} passed, ${failed} failed / ${tests.length + 3} total`);
process.exit(failed > 0 ? 1 : 0);
