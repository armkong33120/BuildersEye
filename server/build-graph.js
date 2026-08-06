// build-graph.js — สร้าง identity-graph.json จาก Employee Registry (single source of truth)
// ทำให้ 3D graph ตามข้อมูล OneDrive จริงเสมอ: คนเข้า/ออก/ย้ายผู้จัดการ → regenerate แล้วกราฟตามทัน
// ใช้: node build-graph.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getActiveEmployees } from './employeeRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_FILE = path.join(__dirname, '..', 'src', 'data', 'identity-graph.json');

// เก็บสี department เดิมไว้ (UI consistency) — dept ใหม่จะ generate สีจาก hash
function loadExistingColors() {
  try {
    const d = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf-8'));
    return new Map((d.departments || []).map(dep => [dep.name, dep.color]));
  } catch { return new Map(); }
}

function deptColor(name, existing) {
  if (existing.has(name)) return existing.get(name);
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 58%, 46%)`;
}

function slugify(name) {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function buildGraphFromRegistry() {
  const employees = getActiveEmployees().filter(e => e.pk != null);
  const byCode = new Map(employees.map(e => [String(e.code).toUpperCase(), e]));
  const existingColors = loadExistingColors();

  // direct reports
  const reportsOf = new Map(); // managerCode → [employee]
  for (const e of employees) {
    const mc = String(e.managerCode || '').toUpperCase();
    if (!mc || !byCode.has(mc)) continue;
    if (!reportsOf.has(mc)) reportsOf.set(mc, []);
    reportsOf.get(mc).push(e);
  }

  // manager chain + depth (with cycle guard)
  function chainOf(e) {
    const chain = [];
    const seen = new Set([e.code]);
    let cur = e;
    while (cur.managerCode) {
      const mgr = byCode.get(String(cur.managerCode).toUpperCase());
      if (!mgr || seen.has(mgr.code)) break;
      chain.push(mgr.pk);
      seen.add(mgr.code);
      cur = mgr;
    }
    return chain;
  }

  const ceo = employees.find(e => /ceo/i.test(e.roleGroup || '')) || employees.find(e => !e.managerCode) || employees[0];

  const identities = employees.map(e => {
    const mgr = e.managerCode ? byCode.get(String(e.managerCode).toUpperCase()) : null;
    const reports = (reportsOf.get(String(e.code).toUpperCase()) || []).sort((a, b) => a.pk - b.pk);
    const chain = chainOf(e);
    return {
      pk: e.pk,
      code: e.code,
      name: e.name,
      department: e.department,
      jobTitle: e.jobTitle,
      roleGroup: e.roleGroup,
      managerPk: mgr ? mgr.pk : null,
      managerCode: mgr ? mgr.code : '',
      managerName: mgr ? mgr.name : '',
      managerJobTitle: mgr ? mgr.jobTitle : '',
      directReportPks: reports.map(r => r.pk),
      directReportCount: reports.length,
      managerChainPks: chain,
      subtreePks: [e.pk],
      hierarchyDepth: chain.length,
    };
  }).sort((a, b) => a.pk - b.pk);

  const reportingLinks = [];
  for (const e of identities) {
    if (e.managerPk != null) {
      reportingLinks.push({
        sourcePk: e.managerPk, targetPk: e.pk,
        sourceCode: e.managerCode, targetCode: e.code,
        relationship: 'reports_to_manager',
      });
    }
  }

  const deptMap = new Map();
  for (const e of identities) {
    if (!deptMap.has(e.department)) deptMap.set(e.department, 0);
    deptMap.set(e.department, deptMap.get(e.department) + 1);
  }
  const departments = [...deptMap.entries()]
    .map(([name, count]) => ({ name, slug: slugify(name), color: deptColor(name, existingColors), employeeCount: count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const graph = {
    generatedAt: new Date().toISOString(),
    source: 'employee-registry (OneDrive-driven)',
    tenant: 'demo-company',
    mailDomain: 'demo-company.co.th',
    ceoPk: ceo?.pk ?? 1,
    departments,
    identities,
    reportingLinks,
    stats: {
      employeeCount: identities.length,
      reportingLinkCount: reportingLinks.length,
      departmentCount: departments.length,
      oneDriveSiteCount: identities.length,
      maxDepth: Math.max(0, ...identities.map(i => i.hierarchyDepth)),
    },
  };

  fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 1), 'utf-8');
  return graph.stats;
}

// run ตรงๆ
if (process.argv[1] && process.argv[1].endsWith('build-graph.js')) {
  const stats = buildGraphFromRegistry();
  console.log('✅ identity-graph.json regenerated from registry:', JSON.stringify(stats));
}
