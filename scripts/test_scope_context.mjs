// test_scope_context.mjs — Unit tests for resolveViewerScope (canonical scope bridge).
// Run: node scripts/test_scope_context.mjs
// Uses a temp ACCESS_DATA_DIR so it never touches real runtime data.

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-scope-test-'));
process.env.ACCESS_DATA_DIR = TMP;

const { seedAccessModel, resolveViewerScope } = await import('../server/access/index.js');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

console.log('🧪 Scope context unit tests\n');

seedAccessModel({ employees: [
  { code: 'EMP001', pk: 1, name: 'CEO', jobTitle: 'CEO', roleGroup: 'CEO', department: 'Executive', managerCode: '' },
  { code: 'EMP002', pk: 2, name: 'Mgr', jobTitle: 'Manager', department: 'Sales', managerCode: 'EMP001' },
  { code: 'EMP003', pk: 3, name: 'Emp', jobTitle: 'Staff', department: 'Sales', managerCode: 'EMP002' },
  { code: 'EMP004', pk: 4, name: 'Emp2', jobTitle: 'Staff', department: 'Sales', managerCode: 'EMP002' },
]});

// registry-style employees (code/pk/managerCode/status) — current org truth
const registry = [
  { code: 'EMP001', pk: 1, managerCode: '', status: 'active' },
  { code: 'EMP002', pk: 2, managerCode: 'EMP001', status: 'active' },
  { code: 'EMP003', pk: 3, managerCode: 'EMP002', status: 'active' },
  { code: 'EMP004', pk: 4, managerCode: 'EMP002', status: 'active' },
];

const ceo = resolveViewerScope({ role: 'CEO', employeeId: 1 }, { employees: registry });
assert('CEO → ALL (null)', ceo.scopeCodes === null && ceo.allowed === true);

const mgr = resolveViewerScope({ role: 'Manager', employeeId: 2 }, { employees: registry });
assert('Manager → SUBTREE (self + 2 reports)', mgr.scopeCodes instanceof Set && mgr.scopeCodes.size === 3
  && mgr.scopeCodes.has('EMP002') && mgr.scopeCodes.has('EMP003') && mgr.scopeCodes.has('EMP004'));

const emp = resolveViewerScope({ role: 'Employee', employeeId: 3 }, { employees: registry });
assert('Employee → SELF only', emp.scopeCodes instanceof Set && emp.scopeCodes.size === 1 && emp.scopeCodes.has('EMP003'));

const unknown = resolveViewerScope({ role: 'Employee', employeeId: 999 }, { employees: registry });
// Deny-by-default: unknown viewer yields an EMPTY Set — the security boundary that
// makes every retrieval/SQL/vector path return nothing (never the full corpus).
assert('Unknown viewer → empty Set (deny-by-default, no data)', unknown.scopeCodes instanceof Set && unknown.scopeCodes.size === 0);

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
