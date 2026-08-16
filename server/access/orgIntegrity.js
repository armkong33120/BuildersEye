// orgIntegrity.js — Write-path org integrity validation (pure functions).
//
// Every employee/relationship write in adminService.js validates the ENTIRE org
// (with the proposed change applied) BEFORE persisting anything, so a rejected
// write can never leave a partial store behind.
//
// These functions are PURE (no I/O) and throw errors in the adminService
// convention: { status, message }. `employees` accepts either the normalized
// access-store shape ({ employeeCode, managerCode, ... }) or the registry /
// identity-graph shape ({ code, managerCode, ... }). `relationships` is the
// temporal access-store shape ({ employeeCode, managerCode, ... }).
//
// Security posture:
//   - duplicate employee codes          → 409
//   - self-manager / hierarchy cycles   → 400 / 409
//   - non-null managerCode that does not resolve to an existing employee → 400
//   - NULL (or empty) managerCode       → root — ALWAYS allowed (multi-root orgs
//     are a first-class supported shape, never rejected)

import { employeeKey } from './accessModel.js';

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

// Reject duplicate employee codes (case-insensitive, whitespace-trimmed).
// Throws { status: 409, message: 'duplicate employeeCode <CODE>' }.
export function assertNoDuplicateEmployeeCodes(employees) {
  const seen = new Set();
  for (const emp of employees || []) {
    if (!emp) continue;
    const code = employeeKey(emp.employeeCode ?? emp.code);
    if (!code) continue;
    if (seen.has(code)) {
      fail(409, `duplicate employeeCode ${code}`);
    }
    seen.add(code);
  }
  return true;
}

// Build the effective manager map for the whole org:
//   - relationships (temporal edges) win; later entries override earlier ones,
//   - any employee without an explicit relationship edge falls back to its own
//     managerCode field.
// Returns Map<employeeCode, managerCode | null>.
function buildManagerMap(employees, relationships) {
  const managerOf = new Map();
  for (const r of relationships || []) {
    const child = employeeKey(r.employeeCode ?? r.childCode);
    if (!child) continue;
    const mgr = employeeKey(r.managerCode ?? r.parentCode);
    managerOf.set(child, mgr || null);
  }
  for (const e of employees || []) {
    if (!e) continue;
    const code = employeeKey(e.code ?? e.employeeCode);
    if (!code || managerOf.has(code)) continue;
    const mgr = employeeKey(e.managerCode);
    managerOf.set(code, mgr || null);
  }
  return managerOf;
}

// Reject cycles in the manager graph:
//   - direct self-manager (A→A)                     → 400
//   - direct cycles (A→B→A) and longer cycles (A→B→C→A) → 409
// The graph is walked over manager→manager edges (an employee "points at" the
// employee they report to), so a cycle A→B→A is detected regardless of which
// node the DFS starts from.
export function assertAcyclicManagerGraph(employees, relationships = []) {
  const managerOf = buildManagerMap(employees, relationships);

  // Self-manager is a distinct, more specific failure (400).
  for (const [node, mgr] of managerOf.entries()) {
    if (mgr && mgr === node) {
      fail(400, `self-manager cycle detected: ${node} reports to itself`);
    }
  }

  // Generic cycle detection (DFS with an explicit recursion stack).
  const visited = new Set(); // fully processed nodes
  const stack = new Set();   // nodes on the current DFS path
  const dfs = (node) => {
    if (stack.has(node)) return node; // back-edge → cycle involving `node`
    if (visited.has(node)) return null;
    stack.add(node);
    const mgr = managerOf.get(node);
    const cycle = mgr ? dfs(mgr) : null;
    stack.delete(node);
    visited.add(node);
    return cycle;
  };

  for (const node of managerOf.keys()) {
    const cycleNode = dfs(node);
    if (cycleNode) {
      fail(409, `hierarchy cycle detected involving ${cycleNode}`);
    }
  }
  return true;
}

// Reject non-null managerCode values that do not resolve to an existing
// employee. NULL (or empty) managerCode = root — allowed, so multi-root orgs
// are preserved. Checks both the employees' own managerCode fields and the
// relationship edges. Throws { status: 400, message: 'manager <CODE> does not exist' }.
export function assertManagerExists(employees, relationships = []) {
  const codes = new Set();
  for (const e of employees || []) {
    if (!e) continue;
    const code = employeeKey(e.code ?? e.employeeCode);
    if (code) codes.add(code);
  }

  for (const e of employees || []) {
    if (!e) continue;
    const mgr = employeeKey(e.managerCode);
    if (mgr && !codes.has(mgr)) {
      fail(400, `manager ${mgr} does not exist`);
    }
  }

  for (const r of relationships || []) {
    const mgr = employeeKey(r.managerCode ?? r.parentCode);
    if (mgr && !codes.has(mgr)) {
      fail(400, `manager ${mgr} does not exist`);
    }
  }
  return true;
}

// Run the full write-path integrity suite over the whole org (with the proposed
// change already applied to `employees` / `relationships`). Throws the first
// violation; returns true when the org is consistent.
export function assertOrgIntegrity(employees, relationships = []) {
  assertNoDuplicateEmployeeCodes(employees);
  assertAcyclicManagerGraph(employees, relationships);
  assertManagerExists(employees, relationships);
  return true;
}
