// groundTruth.mjs — Ground-truth derivation for the BuildersEye RAG benchmark.
//
// Every assertion in the benchmark dataset is derived from the committed
// synthetic HR data (identity-graph.json + master-index.json + HR JSON files),
// NOT hand-guessed. These helpers are used both by the dataset validator and
// (optionally) by the programmatic case generator.
//
// SECURITY/PURITY: this module only READS data files. It never invokes the
// LLM or the pipeline, so ground truth cannot be contaminated by the system
// under test.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');

let _identityGraph = null;
let _masterIndex = null;
let _indexByPk = null;
let _indexByCode = null;

export function loadIdentityGraph() {
  if (_identityGraph) return _identityGraph;
  try {
    _identityGraph = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'identity-graph.json'), 'utf-8'));
  } catch (e) {
    _identityGraph = { identities: [], departments: [], ceoPk: null };
  }
  return _identityGraph;
}

export function loadMasterIndex() {
  if (_masterIndex) return _masterIndex;
  try {
    _masterIndex = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'master-index.json'), 'utf-8'));
    _indexByPk = new Map(_masterIndex.map((e) => [e.employeeId, e]));
    _indexByCode = new Map(
      _masterIndex.map((e) => [String(e.employeeCode || ('EMP' + String(e.employeeId).padStart(3, '0'))).toLowerCase(), e])
    );
  } catch (e) {
    _masterIndex = [];
    _indexByPk = new Map();
    _indexByCode = new Map();
  }
  return _masterIndex;
}

export function identities() {
  return loadIdentityGraph().identities || [];
}

export function departments() {
  return loadIdentityGraph().departments || [];
}

export function ceoPk() {
  return loadIdentityGraph().ceoPk || 1;
}

/** Normalize "EMP042" / "emp042" / "42" → pk integer, or null. */
export function pkFromRef(ref) {
  if (typeof ref === 'number') return ref;
  const s = String(ref).trim();
  const m = s.match(/^EMP\s*(\d{1,3})$/i) || s.match(/^(\d{1,3})$/);
  if (!m) return null;
  const pk = parseInt(m[1], 10);
  return pk >= 1 && pk <= 150 ? pk : null;
}

export function employeeByPk(pk) {
  loadMasterIndex();
  return _indexByPk.get(pk) || null;
}

export function employeeByCode(code) {
  loadMasterIndex();
  return _indexByCode.get(String(code).toLowerCase()) || null;
}

/** identity-graph identity entry for a pk. */
export function identityByPk(pk) {
  return identities().find((i) => i.pk === pk) || null;
}

/** All identity entries whose department matches (case-insensitive, fuzzy). */
export function identitiesInDept(deptName) {
  const wanted = String(deptName).toLowerCase().trim();
  return identities().filter((i) => String(i.department || '').toLowerCase() === wanted);
}

/** pks of every employee in a department. */
export function employeesInDept(deptName) {
  return identitiesInDept(deptName).map((i) => i.pk);
}

/** Department names (canonical order from identity-graph). */
export function departmentNames() {
  return departments().map((d) => d.name);
}

/** Resolve a department reference by name or slug. */
export function resolveDepartment(ref) {
  const s = String(ref).toLowerCase().trim();
  for (const d of departments()) {
    if (d.name.toLowerCase() === s) return d.name;
    if ((d.slug || '').toLowerCase() === s) return d.name;
  }
  return null;
}

/** Direct reports of a pk (from identity-graph). */
export function directReports(pk) {
  const idn = identityByPk(pk);
  return (idn && idn.directReportPks) || [];
}

/** Full subtree pks of a pk (self + descendants). */
export function subtreePks(pk) {
  const idn = identityByPk(pk);
  return (idn && idn.subtreePks) || [pk];
}

/** Manager pk of a pk. */
export function managerOf(pk) {
  const idn = identityByPk(pk);
  return (idn && idn.managerPk) || null;
}

/** Deterministic fact lookup from master-index for a pk (e.g. kpi, level, band, dept). */
export function factFor(pk, field) {
  const e = employeeByPk(pk);
  if (!e) return null;
  return e[field] != null ? e[field] : null;
}

/** Name of a pk (from master-index, Thai). */
export function nameOf(pk) {
  const e = employeeByPk(pk);
  return (e && e.employeeName) || null;
}

/** Position/title of a pk. */
export function positionOf(pk) {
  const e = employeeByPk(pk);
  return (e && e.currentPosition) || null;
}

/** Validate a dataset case against the committed data. Returns list of issues ([] = valid). */
export function validateCase(c) {
  const issues = [];
  if (!c.id) issues.push('missing id');
  if (!c.query) issues.push('missing query');
  if (!c.category) issues.push('missing category');
  if (!c.role) issues.push('missing role');
  const idn = identities();
  for (const pk of c.expectedEmployeeIds || []) {
    if (!identityByPk(pk)) issues.push(`expectedEmployeeIds[${pk}] not in identity-graph`);
  }
  const deptNames = new Set(departmentNames().map((d) => d.toLowerCase()));
  for (const d of c.expectedDepartments || []) {
    if (!deptNames.has(String(d).toLowerCase())) issues.push(`expectedDepartments[${d}] not a known department`);
  }
  for (const pk of c.expectedSources || []) {
    if (!identityByPk(pk)) issues.push(`expectedSources[${pk}] not in identity-graph`);
  }
  return issues;
}
