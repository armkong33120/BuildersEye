// test_policy_thai_bonus.mjs — Policy regression tests for Thai โบนัส (bonus).
// Imports checkQueryPolicy directly (no HTTP server needed).
// Usage: node scripts/test_policy_thai_bonus.mjs
import { checkQueryPolicy } from '../server/policy.js';

const tests = [
  // ── Employee: fully blocked (own / others / aggregate) ──
  ['Employee', 'โบนัสของ EMP010 เท่าไหร่', 'Blocked'],
  ['Employee', 'โบนัสของ CEO เท่าไหร่', 'Blocked'],
  ['Employee', 'โบนัสของฉันเท่าไหร่', 'Blocked'],
  ['Employee', 'โบนัสเฉลี่ยของพนักงานทั้งหมด', 'Blocked'],
  ['Employee', 'ค่าตอบแทนของ CEO เท่าไหร่', 'Blocked'],
  ['Employee', 'โบนัสและ incentive ของ EMP001', 'Blocked'],
  ['Employee', 'เงินเดือนของ EMP010', 'Blocked'], // salary regression
  // ── Manager: individual & company-wide blocked; team aggregate allowed ──
  ['Manager', 'โบนัสของ EMP042 เท่าไหร่', 'Blocked'],
  ['Manager', 'โบนัสเฉลี่ยทั้งบริษัทเท่าไหร่', 'Blocked'],
  ['Manager', 'compensation ของ EMP001', 'Blocked'], // regression
  ['Manager', 'เงินเดือนเฉลี่ยทั้งบริษัทเท่าไหร่', 'Blocked'], // regression
  ['Manager', 'โบนัสเฉลี่ยของทีมฉันเท่าไหร่', 'Allowed'],
  ['Manager', 'โบนัสรวมของลูกทีม', 'Allowed'],
  // ── CEO / HR: allowed ──
  ['CEO', 'โบนัสเฉลี่ยของพนักงานทุกคน', 'Allowed'],
  ['HR', 'โบนัสของ EMP042', 'Allowed'],
];

let passed = 0, failed = 0;
for (const [role, query, expected] of tests) {
  const got = checkQueryPolicy(query, role).status;
  const ok = got === expected;
  if (ok) { passed++; console.log(`  ✅ ${role} "${query}" → ${got}`); }
  else { failed++; console.log(`  ❌ ${role} "${query}" → got ${got}, expected ${expected}`); }
}
console.log(`\n📊 Policy Thai-bonus tests: ${passed} passed, ${failed} failed / ${tests.length} total`);
process.exit(failed > 0 ? 1 : 0);
