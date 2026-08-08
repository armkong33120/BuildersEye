import { parseIntent, hasAnalyticsIntent } from './intentParser.js';
import { analyticsMin, analyticsMax, filterEmployees } from './analyticsEngine.js';
import { VIEWER_ROLES } from './policy.js';

// 7 matchers + merge/rank + answer builder
function tokenize(text) {
  if (!text) return [];
  const clean = String(text).toLowerCase().replace(/[^\p{L}\p{N}@._/-]+/gu, ' ').trim();
  return clean.split(/\s+/).filter(t => t.length >= 1);
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

function keywordSearch(query, searchIndex, flatIndex, scopeCodes = null) {
  const tokens = tokenize(query);
  const scored = new Map();
  for (const token of tokens) {
    const refs = searchIndex.get(token) || [];
    for (const idx of refs) {
      const rec = flatIndex[idx];
      if (!rec) continue; // index อาจชี้ตำแหน่งที่ไม่อยู่ใน scoped array
      const pk = rec.employeeId;
      // RBAC: ถ้ามี scope → ข้ามคนนอก scope (กรองหลังดึง rec จริง)
      if (scopeCodes && rec.employeeCode && !scopeCodes.has(rec.employeeCode)) continue;
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
  const cm = query.match(/EMP(\d{1,3})/i);
  const nm = query.match(/\b(\d{1,3})\b/);
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
  const m = query.match(/PRJ(\d{3})/i);
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
  answer += ':\n';
  for (const r of results.slice(0, 5)) {
    const profile = r.matchedRecords?.find(rec => rec.sheetName === 'Employee_Profile' && rec.fieldName === 'name');
    const title = r.matchedRecords?.find(rec => rec.fieldName === 'jobTitle');
    const name = profile?.content || 'EMP' + String(r.employeeId).padStart(3, '0');
    const titleText = title?.content || '';
    answer += '- ' + name + (titleText ? ' (' + titleText + ')' : '') + ' [score: ' + r.score.toFixed(1) + ']\n';
    // Add matched context
    const fields = r.matchedFields?.slice(0, 3) || [];
    if (fields.length > 0) answer += '  Matched: ' + fields.join(', ') + '\n';
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

export function search(query, { flatIndex, searchIndex }, parsedIntent = null, scopeCodes = null, viewerRole = null) {
  const parsed = parsedIntent || parseIntent(query);

  // RBAC scope filter (analytics/filter path): ถ้า scopeCodes เป็น Set → จำกัด flatIndex
  // ให้เห็นเฉพาะคนใน scope ก่อนคำนวณ min/max/filter (เหมือน scoped table ใน SQL path)
  // เพื่อให้ ANALYTICS_MIN/MAX และ filterEmployees ทำงานในขอบเขตเดียวกับ keyword path
  const scopedFlatIndex = (scopeCodes instanceof Set && scopeCodes.size > 0)
    ? flatIndex.filter(r => scopeCodes.has(r.employeeCode))
    : flatIndex;

  // Layer 3 — template redaction: ตรวจว่า role มีสิทธิ์เห็น warnings/sensitive fields ไหม
  const canSeeWarnings = viewerRole ? (VIEWER_ROLES[viewerRole]?.canSeeWarnings !== false) : true;

  // LOOP 13D: Handle EXACT_EMPLOYEE + ANALYTICS intents correctly
  // Step 1: If there's an EXACT_EMPLOYEE intent, narrow scope to that employee
  const exactEmpIntent = parsed.intents?.find(i => i.type === 'EXACT_EMPLOYEE');
  const analyticsIntent = parsed.intents?.find(i => i.type === 'ANALYTICS_MIN' || i.type === 'ANALYTICS_MAX');
  const activeFilters = [...(parsed.filters || [])];

  if (exactEmpIntent && exactEmpIntent.pk) {
    // Add a scope filter: only look at this specific employee's records
    const empRecords = scopedFlatIndex.filter(r => r.employeeId === exactEmpIntent.pk);
    if (empRecords.length > 0) {
      // If there's also an analytics intent, run analytics on this specific employee
      if (analyticsIntent) {
        const results = [{
          employeeId: exactEmpIntent.pk,
          score: 100,
          matchedFields: [analyticsIntent.field],
          matchedRecords: empRecords,
        }];
        const profileRec = empRecords.find(r => r.sheetName === 'Employee_Profile' && r.fieldName === 'name');
        const titleRec = empRecords.find(r => r.sheetName === 'Employee_Profile' && r.fieldName === 'jobTitle');
        const deptRec = empRecords.find(r => r.sheetName === 'Employee_Profile' && r.fieldName === 'department');
        const name = profileRec?.content || 'EMP' + String(exactEmpIntent.pk).padStart(3, '0');
        const jobTitle = titleRec?.content || '';
        const dept = deptRec?.content || '';

        const fieldLabel = analyticsIntent.field === 'kpiScore' ? 'KPI' : 'OKR';
        // Find the most recent KPI/OKR value for this employee
        const kpiRecs = empRecords.filter(r => r.fieldName === analyticsIntent.field);
        const latestKpi = kpiRecs.sort((a, b) => (b.rowNumber || 0) - (a.rowNumber || 0))[0];
        const bandRec = empRecords.find(r => r.fieldName === 'performanceBand');

        // Layer 3: redact warnings ถ้า role ไม่มีสิทธิ์ (Employee) — ไม่โชว์จำนวน warnings
        let answer = name + (jobTitle ? ' (' + jobTitle + ')' : '') + ' [' + dept + ']\n';
        if (latestKpi) answer += '  ' + fieldLabel + ' Score: ' + latestKpi.content + '\n';
        if (bandRec) answer += '  Performance Band: ' + bandRec.content + '\n';
        if (canSeeWarnings) {
          const warnCount = empRecords.filter(r => r.sheetName === 'Warning_Disciplinary_History').length;
          answer += '  Total Warnings: ' + warnCount;
        }
        return { results, answer, sources: buildSources(results, scopedFlatIndex), matchersUsed: ['exact-employee-analytics'] };
      }
      // Just EXACT_EMPLOYEE with no analytics — return their full profile
      const results = [{ employeeId: exactEmpIntent.pk, score: 100, matchedFields: ['code'], matchedRecords: empRecords }];
      const answer = buildAnswer(query, results);
      return { results, answer, sources: buildSources(results, scopedFlatIndex), matchersUsed: ['exact-employee'] };
    }
  }

  // Step 2: Analytics intents (without EXACT_EMPLOYEE scope)
  if (analyticsIntent) {
    let analyticsResult;
    if (analyticsIntent.type === 'ANALYTICS_MIN') {
      analyticsResult = analyticsMin(scopedFlatIndex, analyticsIntent.field, activeFilters, scopeCodes);
    } else if (analyticsIntent.type === 'ANALYTICS_MAX') {
      analyticsResult = analyticsMax(scopedFlatIndex, analyticsIntent.field, activeFilters, scopeCodes);
    }
    if (analyticsResult) {
      const results = [{ employeeId: analyticsResult.employeeId, score: 100, matchedFields: [analyticsIntent.field], matchedRecords: analyticsResult.records }];
      const fieldLabel = analyticsIntent.field === 'kpiScore' ? 'KPI' : 'OKR';
      const metricLabel = analyticsIntent.metric === 'min' ? 'lowest (minimum)' : 'highest (maximum)';
      let answer = fieldLabel + ' ' + metricLabel + ':\n- ' + analyticsResult.name + ' (' + analyticsResult.jobTitle + ') [' + analyticsResult.department + ']\n  Value: ' + analyticsResult.value + '\n';
      const bandRec = analyticsResult.records.find(r => r.fieldName === 'performanceBand');
      if (bandRec) answer += '  Performance Band: ' + bandRec.content + '\n';
      // Layer 3: redact warnings ถ้า role ไม่มีสิทธิ์ (Employee)
      if (canSeeWarnings) {
        const warnCount = analyticsResult.records.filter(r => r.sheetName === 'Warning_Disciplinary_History').length;
        answer += '  Total Warnings: ' + warnCount;
      }
      return { results, answer, sources: buildSources(results, scopedFlatIndex), matchersUsed: ['analytics-' + analyticsIntent.type] };
    }
  }

  // Step 3: Filters without analytics
  if (activeFilters.length > 0) {
    const filtered = filterEmployees(scopedFlatIndex, activeFilters, scopeCodes);
    if (filtered.length > 0) {
      const results = filtered.map(f => ({ ...f, matchedFields: Array.from(f.matchedFields) }));
      const answer = buildAnswer(query, results);
      return { results, answer, sources: buildSources(results, scopedFlatIndex), matchersUsed: ['filter'] };
    }
  }

  // Step 4: Fallback to existing 7 matchers — keywordSearch ใช้ flatIndex เต็ม (searchIndex
  // ชี้ idx ของ flatIndex เต็ม) แล้วกรอง scopeCodes ภายใน; matchers ที่วนบน data ใช้ scopedFlatIndex
  const matcherResults = {
    keyword: keywordSearch(query, searchIndex, flatIndex, scopeCodes),
    department: departmentSearch(query, scopedFlatIndex),
    employeeId: employeeIdSearch(query, scopedFlatIndex),
    employeeName: employeeNameSearch(query, scopedFlatIndex),
    sheetCategory: sheetCategorySearch(query, scopedFlatIndex),
    severityBand: severityBandSearch(query, scopedFlatIndex),
    projectId: projectIdSearch(query, scopedFlatIndex),
  };
  const matchersUsed = Object.entries(matcherResults).filter(([_, r]) => r.size > 0).map(([n]) => n);
  const results = mergeAndRank(matcherResults);
  const answer = buildAnswer(query, results);
  const sources = buildSources(results, scopedFlatIndex);
  return { results, answer, sources, matchersUsed };
}
