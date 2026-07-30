#!/usr/bin/env python3
"""Write all 5 backend JS files for BuildersEye RAG server."""
import os

BASE = "/Users/arm/AI Test/mail-onedrive-org-graph/server"

# File 1: ingestExcel.js
with open(os.path.join(BASE, "ingestExcel.js"), "w") as f:
    f.write("""import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

const CONFIDENTIALITY_MAP = {
  'Executive': 'Tier 1 — Strict',
  'HR & Admin': 'Tier 1 — Strict',
  'Finance & Accounting': 'Tier 1 — Strict',
  'Legal': 'Tier 1 — Strict',
  'IT': 'Tier 2 — Sensitive',
};

function tokenize(text) {
  if (!text) return [];
  const clean = String(text).toLowerCase().replace(/[^\\p{L}\\p{N}@._/-]+/gu, ' ').trim();
  return clean.split(/\\s+/).filter(t => t.length >= 1);
}

function parseSheet(workbook, sheetName) {
  if (!workbook.SheetNames.includes(sheetName)) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 4) return [];
  const headers = rows[2];
  if (!headers) return [];
  const records = [];
  for (let r = 3; r < rows.length; r++) {
    const rowData = rows[r];
    if (!rowData || rowData.every(c => c === '' || c === null || c === undefined)) continue;
    for (let c = 0; c < headers.length; c++) {
      const fieldName = String(headers[c] || '').trim();
      const content = String(rowData[c] || '').trim();
      if (!fieldName || content === '') continue;
      records.push({ rowNumber: r + 1, fieldName, content });
    }
  }
  return records;
}

function getRecordType(sheetName) {
  const map = {
    'Employee_Profile': 'identity',
    'Career_Timeline': 'career',
    'KPI_OKR_History': 'kpi',
    'Project_History': 'project',
    'Collaboration_Network': 'collaboration',
    'Warning_Disciplinary_History': 'warning',
    'Learning_Development': 'learning',
  };
  return map[sheetName] || 'unknown';
}

export function ingestAll(dataDir) {
  const flatIndex = [];
  const searchIndex = new Map();
  const files = fs.readdirSync(dataDir).filter(f => /^EMP\\d{3}.*\\.xlsx$/i.test(f));
  if (files.length === 0) throw new Error('No EMP*.xlsx files found in ' + dataDir);

  for (const fileName of files) {
    const filePath = path.join(dataDir, fileName);
    const workbook = xlsx.readFile(filePath);
    const code = fileName.match(/EMP\\d{3}/i)?.[0] || fileName.replace('.xlsx', '');

    const profileData = parseSheet(workbook, 'Employee_Profile');
    if (!profileData || profileData.length === 0) continue;

    const employeeId = parseInt(profileData.find(c => c.fieldName === 'pk')?.content || '0');
    const employeeName = profileData.find(c => c.fieldName === 'name')?.content || '';
    const department = profileData.find(c => c.fieldName === 'department')?.content || '';
    const confidentiality = CONFIDENTIALITY_MAP[department] || 'Tier 3 — Standard';

    if (employeeId < 1 || employeeId > 150) continue;

    for (const sheetName of workbook.SheetNames) {
      for (const record of parseSheet(workbook, sheetName)) {
        const entry = {
          employeeId, employeeCode: code, employeeName, department,
          sheetName, rowNumber: record.rowNumber, fieldName: record.fieldName,
          content: record.content, confidentialityLevel: confidentiality,
          fileName, filePath, recordType: getRecordType(sheetName),
        };
        flatIndex.push(entry);
        const idx = flatIndex.length - 1;
        const tokens = tokenize(record.content);
        for (const token of tokens) {
          if (!searchIndex.has(token)) searchIndex.set(token, []);
          searchIndex.get(token).push(idx);
        }
      }
    }
  }

  return { flatIndex, searchIndex, totalFiles: files.length };
}
""")
print("Wrote ingestExcel.js")

# File 2: searchIndex.js
with open(os.path.join(BASE, "searchIndex.js"), "w") as f:
    f.write("""// 7 matchers + merge/rank + answer builder
function tokenize(text) {
  if (!text) return [];
  const clean = String(text).toLowerCase().replace(/[^\\p{L}\\p{N}@._/-]+/gu, ' ').trim();
  return clean.split(/\\s+/).filter(t => t.length >= 1);
}

function getFieldWeight(fieldName, sheetName) {
  const weights = {
    name: 10, code: 15, pk: 15, department: 8, jobTitle: 7, email: 12,
    performanceBand: 6, severity: 6, caseType: 5, summary: 4, feedback: 4,
    projectId: 5, trainingName: 3, skillArea: 3,
  };
  if (weights[fieldName]) return weights[fieldName];
  if (sheetName === 'Employee_Profile') return 2;
  return 1;
}

function keywordSearch(query, searchIndex, flatIndex) {
  const tokens = tokenize(query);
  const scored = new Map();
  for (const token of tokens) {
    const refs = searchIndex.get(token) || [];
    for (const idx of refs) {
      const rec = flatIndex[idx];
      const pk = rec.employeeId;
      if (!scored.has(pk)) scored.set(pk, { score: 0, matchedFields: new Set(), matchedRecords: [] });
      const entry = scored.get(pk);
      entry.score += getFieldWeight(rec.fieldName, rec.sheetName);
      entry.matchedFields.add(rec.sheetName + '.' + rec.fieldName);
      entry.matchedRecords.push(rec);
    }
  }
  return scored;
}

function departmentSearch(query, flatIndex) {
  const deptAliases = {
    'customer service': 'Customer Service & Warranty', 'warranty': 'Customer Service & Warranty',
    'cs': 'Customer Service & Warranty', 'design': 'Design & Architecture',
    'architecture': 'Design & Architecture', 'engineering': 'Engineering & Construction',
    'construction': 'Engineering & Construction', 'executive': 'Executive',
    'exec': 'Executive', 'finance': 'Finance & Accounting', 'accounting': 'Finance & Accounting',
    'hr': 'HR & Admin', 'admin': 'HR & Admin', 'it': 'IT', 'legal': 'Legal',
    'marketing': 'Marketing', 'office': 'Office Support',
    'procurement': 'Procurement & Warehouse', 'warehouse': 'Procurement & Warehouse',
    'sales': 'Sales', 'sale': 'Sales',
  };
  const ql = query.toLowerCase();
  let matched = null;
  for (const [alias, dept] of Object.entries(deptAliases)) {
    if (ql.includes(alias)) { matched = dept; break; }
  }
  // Also try exact match from index
  if (!matched) {
    const deptNames = [...new Set(flatIndex.filter(r => r.fieldName === 'department').map(r => r.content))];
    for (const dn of deptNames) {
      if (ql.includes(dn.toLowerCase())) { matched = dn; break; }
    }
  }
  if (!matched) return new Map();
  const results = new Map();
  for (const rec of flatIndex) {
    if (rec.fieldName === 'department' && rec.content === matched) {
      results.set(rec.employeeId, { score: 50, matchedFields: new Set(['Employee_Profile.department']), matchedRecords: [rec] });
    }
  }
  return results;
}

function employeeIdSearch(query, flatIndex) {
  const cm = query.match(/EMP(\\d{1,3})/i);
  const nm = query.match(/\\b(\\d{1,3})\\b/);
  let pk = null;
  if (cm) pk = parseInt(cm[1]);
  else if (nm) pk = parseInt(nm[1]);
  if (!pk || pk < 1 || pk > 150) return new Map();
  const results = new Map();
  results.set(pk, { score: 100, matchedFields: new Set(['code']), matchedRecords: flatIndex.filter(r => r.employeeId === pk) });
  return results;
}

function employeeNameSearch(query, flatIndex) {
  const qt = tokenize(query);
  const results = new Map();
  for (const rec of flatIndex) {
    if (rec.fieldName !== 'name') continue;
    const nt = tokenize(rec.content);
    const matchCount = qt.filter(t1 => nt.some(t2 => t2.startsWith(t1))).length;
    if (matchCount > 0) {
      results.set(rec.employeeId, { score: 80 * matchCount / qt.length, matchedFields: new Set(['name']), matchedRecords: [rec] });
    }
  }
  return results;
}

function sheetCategorySearch(query, flatIndex) {
  const map = { 'kpi': 'KPI_OKR_History', 'okr': 'KPI_OKR_History', 'performance': 'KPI_OKR_History', 'project': 'Project_History', 'collaboration': 'Collaboration_Network', 'warning': 'Warning_Disciplinary_History', 'disciplinary': 'Warning_Disciplinary_History', 'learning': 'Learning_Development', 'training': 'Learning_Development', 'career': 'Career_Timeline' };
  const ql = query.toLowerCase();
  let matched = null;
  for (const [kw, sheet] of Object.entries(map)) { if (ql.includes(kw)) { matched = sheet; break; } }
  if (!matched) return new Map();
  const results = new Map();
  for (const rec of flatIndex) {
    if (rec.sheetName === matched) {
      if (!results.has(rec.employeeId)) results.set(rec.employeeId, { score: 30, matchedFields: new Set(), matchedRecords: [] });
      results.get(rec.employeeId).score += 1;
      results.get(rec.employeeId).matchedRecords.push(rec);
    }
  }
  return results;
}

function severityBandSearch(query, flatIndex) {
  const sevTerms = ['critical', 'high', 'medium', 'low'];
  const bandTerms = ['exceptional', 'exceeds', 'meets', 'below', 'unsatisfactory', 'exceptional (a)', 'exceeds (b)', 'meets (c)', 'below (d)', 'unsatisfactory (e)'];
  const ql = query.toLowerCase();
  const matchedSev = sevTerms.find(t => ql.includes(t));
  const matchedBand = bandTerms.find(t => ql.includes(t));
  const results = new Map();
  for (const rec of flatIndex) {
    let match = false;
    if (matchedSev && rec.fieldName === 'severity' && rec.content.toLowerCase() === matchedSev) match = true;
    if (matchedBand && rec.fieldName === 'performanceBand' && rec.content.toLowerCase().includes(matchedBand)) match = true;
    if ((ql.includes('ต่ำ') || ql.includes('below')) && rec.fieldName === 'performanceBand' && ['Below (D)', 'Unsatisfactory (E)'].includes(rec.content)) match = true;
    if ((ql.includes('ดี') || ql.includes('สูง') || ql.includes('excellent') || ql.includes('exceeds')) && rec.fieldName === 'performanceBand' && ['Exceptional (A)', 'Exceeds (B)'].includes(rec.content)) match = true;
    if (match) {
      if (!results.has(rec.employeeId)) results.set(rec.employeeId, { score: 60, matchedFields: new Set(), matchedRecords: [] });
      results.get(rec.employeeId).matchedFields.add(rec.fieldName);
      results.get(rec.employeeId).matchedRecords.push(rec);
    }
  }
  return results;
}

function projectIdSearch(query, flatIndex) {
  const m = query.match(/PRJ(\\d{3})/i);
  if (!m) return new Map();
  const pid = 'PRJ' + m[1];
  const results = new Map();
  for (const rec of flatIndex) {
    if (rec.fieldName === 'projectId' && rec.content === pid) {
      if (!results.has(rec.employeeId)) results.set(rec.employeeId, { score: 90, matchedFields: new Set(), matchedRecords: [] });
      results.get(rec.employeeId).matchedFields.add(rec.sheetName + '.projectId');
      results.get(rec.employeeId).matchedRecords.push(rec);
    }
  }
  return results;
}

function mergeAndRank(matcherResults) {
  const merged = new Map();
  for (const [matcherName, results] of Object.entries(matcherResults)) {
    if (!results || results.size === 0) continue;
    for (const [pk, entry] of results) {
      if (!merged.has(pk)) merged.set(pk, { score: 0, matchedFields: new Set(), matchedRecords: [] });
      const m = merged.get(pk);
      m.score += entry.score;
      if (entry.matchedFields) entry.matchedFields.forEach(f => m.matchedFields.add(f));
      if (entry.matchedRecords) m.matchedRecords.push(...entry.matchedRecords);
    }
  }
  return Array.from(merged.entries()).map(([pk, e]) => ({ employeeId: pk, score: e.score, matchedFields: Array.from(e.matchedFields), matchedRecords: e.matchedRecords })).sort((a, b) => b.score - a.score || a.employeeId - b.employeeId).slice(0, 15);
}

function buildAnswer(query, results) {
  if (!results || results.length === 0) return 'No matching employees found.';
  const depts = [...new Set(results.map(r => r.matchedRecords?.[0]?.department).filter(Boolean))];
  let answer = 'Found ' + results.length + ' matching employee(s)';
  if (depts.length > 0) answer += ' in ' + depts.join(', ');
  answer += ':\\n';
  for (const r of results.slice(0, 5)) {
    const profile = r.matchedRecords?.find(rec => rec.sheetName === 'Employee_Profile' && rec.fieldName === 'name');
    const title = r.matchedRecords?.find(rec => rec.fieldName === 'jobTitle');
    const name = profile?.content || 'EMP' + String(r.employeeId).padStart(3, '0');
    const titleText = title?.content || '';
    answer += '- ' + name + (titleText ? ' (' + titleText + ')' : '') + ' [score: ' + r.score.toFixed(1) + ']\\n';
    // Add matched context
    const fields = r.matchedFields?.slice(0, 3) || [];
    if (fields.length > 0) answer += '  Matched: ' + fields.join(', ') + '\\n';
  }
  return answer;
}

function buildSources(results, flatIndex) {
  const sources = [];
  const seen = new Set();
  for (const r of results) {
    for (const rec of (r.matchedRecords || []).slice(0, 3)) {
      const key = rec.fileName + '|' + rec.sheetName;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push({ fileName: rec.fileName, sheetName: rec.sheetName, rowNumber: rec.rowNumber });
      }
    }
  }
  return sources.slice(0, 10);
}

export function search(query, { flatIndex, searchIndex }) {
  const matcherResults = {
    keyword: keywordSearch(query, searchIndex, flatIndex),
    department: departmentSearch(query, flatIndex),
    employeeId: employeeIdSearch(query, flatIndex),
    employeeName: employeeNameSearch(query, flatIndex),
    sheetCategory: sheetCategorySearch(query, flatIndex),
    severityBand: severityBandSearch(query, flatIndex),
    projectId: projectIdSearch(query, flatIndex),
  };
  const matchersUsed = Object.entries(matcherResults).filter(([_, r]) => r.size > 0).map(([n]) => n);
  const results = mergeAndRank(matcherResults);
  const answer = buildAnswer(query, results);
  const sources = buildSources(results, flatIndex);
  return { results, answer, sources, matchersUsed };
}
""")
print("Wrote searchIndex.js")

# File 3: policy.js
with open(os.path.join(BASE, "policy.js"), "w") as f:
    f.write("""const VIEWER_ROLES = {
  CEO: { canSeeAll: true, canSeeSensitive: true, canSeeCompensation: true, canSeeWarnings: true, scope: 'ALL' },
  HR: { canSeeAll: false, canSeeSensitive: true, canSeeCompensation: true, canSeeWarnings: true, scope: 'HR_RECORDS' },
  Manager: { canSeeAll: false, canSeeSensitive: false, canSeeCompensation: false, canSeeWarnings: true, scope: 'SUBTREE' },
  Employee: { canSeeAll: false, canSeeSensitive: false, canSeeCompensation: false, canSeeWarnings: false, scope: 'SELF' },
};

const SENSITIVE_FIELDS = {
  'Employee_Profile': ['mainWeakness', 'retentionRisk', 'successionPotential'],
};

export function checkQueryPolicy(query, viewerRole) {
  const blockedPatterns = {
    Employee: [/salary|compensation|bonus|ค่าจ้าง|เงินเดือน/i],
    Manager: [/salary|compensation|เงินเดือน/i],
    HR: [], CEO: [],
  };
  const patterns = blockedPatterns[viewerRole] || [];
  for (const p of patterns) {
    if (p.test(query)) return { status: 'Blocked', reason: 'Query blocked by governance policy for ' + viewerRole + ' role.' };
  }
  return { status: 'Allowed' };
}

export function resolveScope(viewerRole, viewerPk, targetPk, identityGraph) {
  if (viewerRole === 'CEO') return true;
  if (viewerPk === targetPk) return true;
  if (viewerRole === 'Employee') return false;
  if (viewerRole === 'Manager') {
    const viewer = identityGraph?.identities?.find(e => e.pk === viewerPk);
    if (!viewer) return false;
    return (viewer.subtreePks || []).includes(targetPk) || (viewer.directReportPks || []).includes(targetPk);
  }
  if (viewerRole === 'HR') return true;
  return false;
}

export function applyFieldRedaction(record, viewerRole, viewerPk, targetPk) {
  if (viewerRole === 'CEO') return record;
  if (viewerPk === targetPk) return record;
  if (viewerRole === 'Employee' && viewerPk !== targetPk) {
    return { ...record, content: '[Redacted — Scope]', redacted: true };
  }
  if (viewerRole === 'Manager' || viewerRole === 'HR') {
    const sensFields = SENSITIVE_FIELDS[record.sheetName] || [];
    if (sensFields.includes(record.fieldName)) {
      return { ...record, content: '[Redacted — Policy]', redacted: true };
    }
  }
  return record;
}
""")
print("Wrote policy.js")

# File 4: chatController.js
with open(os.path.join(BASE, "chatController.js"), "w") as f:
    f.write("""import { search } from './searchIndex.js';
import { checkQueryPolicy, resolveScope, applyFieldRedaction } from './policy.js';

export function chatHandler(query, viewer, { flatIndex, searchIndex, identityGraph }) {
  const startTime = Date.now();
  const viewerRole = viewer?.role || 'CEO';
  const viewerPk = viewer?.employeeId || 1;

  const qp = checkQueryPolicy(query, viewerRole);
  if (qp.status === 'Blocked') {
    return { query, answer: 'Query blocked by governance policy.', matchedEmployeePks: [],
      matchedDepartments: [], results: [], sources: [],
      policy: qp, scan: { employeePks: [], highlightEdges: false, sourcePk: 1, durationMs: 0 },
      scannedFileCount: 0, responseTimeMs: Date.now() - startTime, matchersUsed: [] };
  }

  const sr = search(query, { flatIndex, searchIndex });
  const matchedPks = []; const matchedDepts = new Set(); const finalResults = [];
  let redactedCount = 0; let blockedCount = 0;

  for (const entry of sr.results) {
    const pk = entry.employeeId;
    if (!resolveScope(viewerRole, viewerPk, pk, identityGraph)) { blockedCount++; continue; }
    matchedPks.push(pk);
    const dept = entry.matchedRecords?.[0]?.department;
    if (dept) matchedDepts.add(dept);
    const filtered = entry.matchedRecords.map(r => {
      const redacted = applyFieldRedaction(r, viewerRole, viewerPk, pk);
      if (redacted.redacted) redactedCount++;
      return redacted;
    }).filter(r => r.content !== '[Redacted — Scope]');
    finalResults.push({ ...entry, matchedRecords: filtered });
  }

  const policy = { status: redactedCount > 0 ? 'Redacted' : 'Allowed', redactedCount, blockedCount };
  const sources = sr.sources || [];

  return {
    query, answer: sr.answer,
    matchedEmployeePks: matchedPks,
    matchedDepartments: [...matchedDepts],
    results: finalResults.slice(0, 10),
    sources: sources.slice(0, 10),
    policy,
    scan: { employeePks: matchedPks, highlightEdges: true, sourcePk: 1, durationMs: 5200 },
    scannedFileCount: new Set(flatIndex.map(r => r.employeeId)).size,
    responseTimeMs: Date.now() - startTime,
    matchersUsed: sr.matchersUsed,
  };
}
""")
print("Wrote chatController.js")

# File 5: index.js
with open(os.path.join(BASE, "index.js"), "w") as f:
    f.write("""import express from 'express';
import cors from 'cors';
import { ingestAll } from './ingestExcel.js';
import { chatHandler } from './chatController.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5199;

let flatIndex = [];
let searchIndex = new Map();
let identityGraph = null;
let indexReady = false;
let startupTime = null;

async function startup() {
  console.log('[ingest] Starting Excel ingestion...');
  const start = Date.now();

  const oneDrivePath = path.join(
    process.env.HOME || '/Users/arm',
    'Library/CloudStorage/OneDrive-UbonRatchathaniUniversity/BuildersEye HR Demo Dataset/Employees'
  );

  let dataDir = oneDrivePath;
  if (!fs.existsSync(dataDir)) {
    console.warn('[ingest] OneDrive path not found, using local copy');
    dataDir = path.join(__dirname, '..', 'src', 'data', 'hr_onedrive_demo');
  }

  try {
    const result = ingestAll(dataDir);
    flatIndex = result.flatIndex;
    searchIndex = result.searchIndex;
    console.log(`[ingest] Done: ${result.totalFiles} files, ${flatIndex.length} records, ${searchIndex.size} tokens in ${Date.now() - start}ms`);
  } catch (e) {
    console.error('[ingest] Failed:', e.message);
    const fallback = path.join(__dirname, '..', 'src', 'data', 'hr_onedrive_demo');
    console.log('[ingest] Trying fallback:', fallback);
    const result = ingestAll(fallback);
    flatIndex = result.flatIndex;
    searchIndex = result.searchIndex;
    console.log(`[ingest] Fallback: ${result.totalFiles} files, ${flatIndex.length} records`);
  }

  // Load identity graph
  const graphPath = path.join(__dirname, '..', 'src', 'data', 'identity-graph.json');
  try {
    const raw = fs.readFileSync(graphPath, 'utf-8');
    identityGraph = JSON.parse(raw);
  } catch (e) {
    console.warn('[ingest] Could not load identity-graph.json:', e.message);
  }

  indexReady = true;
  startupTime = new Date().toISOString();
}

const app = express();
app.use(cors({ origin: ['http://localhost:5174', 'http://localhost:5173'] }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  const uniqueFiles = new Set(flatIndex.filter(r => r.sheetName === 'Employee_Profile').map(r => r.fileName));
  res.json({
    status: 'ok', uptime: process.uptime(),
    indexedFiles: uniqueFiles.size, indexReady,
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    startupTime,
  });
});

app.get('/api/index/status', (req, res) => {
  const uniqueFiles = new Set(flatIndex.map(r => r.fileName));
  const uniqueEmps = new Set(flatIndex.map(r => r.employeeId));
  res.json({
    totalEmployees: uniqueEmps.size, totalFiles: uniqueFiles.size,
    totalRecords: flatIndex.length, totalTokens: searchIndex.size,
    indexReady, startupTime,
  });
});

app.post('/api/chat', (req, res) => {
  const { query, viewer } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  const result = chatHandler(query, viewer || { role: 'CEO', employeeId: 1 }, { flatIndex, searchIndex, identityGraph });
  res.json(result);
});

const reindex = process.argv.includes('--reindex');
if (reindex) {
  await startup();
  console.log('[index] Reindex complete. Exiting.');
  console.log(JSON.stringify({ totalFiles: new Set(flatIndex.map(r => r.fileName)).size, totalRecords: flatIndex.length, totalTokens: searchIndex.size }));
  process.exit(0);
}

await startup();
app.listen(PORT, () => {
  console.log(`[server] BuildersEye RAG backend on http://localhost:${PORT}`);
  console.log(`[server] Health: http://localhost:${PORT}/api/health`);
  console.log(`[server] Chat: POST http://localhost:${PORT}/api/chat`);
});
""")
print("Wrote index.js")

print("\nAll 5 backend files written successfully.")