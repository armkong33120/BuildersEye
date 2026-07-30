#!/usr/bin/env python3
"""Write LOOP 8 files: intentParser.js, analyticsEngine.js, and updated searchIndex.js"""
import os

BASE = "/Users/arm/AI Test/mail-onedrive-org-graph/server"

# ── File: intentParser.js ──
with open(os.path.join(BASE, "intentParser.js"), "w") as f:
    f.write("""const DEPT_ALIASES = {
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
const SEV_MAP = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const BAND_ALIASES = { exceptional: 'Exceptional (A)', exceeds: 'Exceeds (B)', meets: 'Meets (C)', below: 'Below (D)', unsatisfactory: 'Unsatisfactory (E)' };

export function parseIntent(query) {
  const ql = query.toLowerCase();
  const tokens = ql.split(/\\s+/).filter(Boolean);
  const result = { intents: [], filters: [], sortField: null, sortDir: null, confidence: 0 };

  if (/(kpi|okr).*(min|lowest)/i.test(ql) || /(min|lowest).*(kpi|okr)/i.test(ql)) {
    const field = /okr/i.test(ql) ? 'okrScore' : 'kpiScore';
    result.intents.push({ type: 'ANALYTICS_MIN', field, metric: 'min' });
    result.confidence = 0.9;
  }
  if (/(kpi|okr).*(max|highest)/i.test(ql) || /(max|highest).*(kpi|okr)/i.test(ql)) {
    const field = /okr/i.test(ql) ? 'okrScore' : 'kpiScore';
    result.intents.push({ type: 'ANALYTICS_MAX', field, metric: 'max' });
    result.confidence = 0.9;
  }
  const em = ql.match(/\\bemp(\\d{1,3})\\b/i);
  if (em) { result.intents.push({ type: 'EXACT_EMPLOYEE', pk: parseInt(em[1]) }); result.confidence = 1.0; }
  if (/training.*(incomplete|not complete)/i.test(ql))
    result.filters.push({ field: 'completionStatus', operator: 'eq', value: 'Incomplete', sheet: 'Learning_Development' });
  if (/formal\\s*warning/i.test(ql))
    result.filters.push({ field: 'formalWarning', operator: 'eq', value: 'Yes', sheet: 'Warning_Disciplinary_History' });
  for (const token of tokens) {
    const dt = DEPT_ALIASES[token];
    if (dt) { result.filters.push({ field: 'department', operator: 'eq', value: dt }); break; }
  }
  for (const token of tokens) {
    const sv = SEV_MAP[token];
    if (sv && !result.filters.some(f => f.field === 'severity')) {
      result.filters.push({ field: 'severity', operator: 'eq', value: sv }); break;
    }
  }
  for (const [alias, band] of Object.entries(BAND_ALIASES)) {
    if (ql.includes(alias)) {
      if (alias === 'below') result.filters.push({ field: 'performanceBand', operator: 'in', value: ['Below (D)', 'Unsatisfactory (E)'] });
      else if (alias === 'exceptional' || alias === 'exceeds') result.filters.push({ field: 'performanceBand', operator: 'in', value: ['Exceptional (A)', 'Exceeds (B)'] });
      else result.filters.push({ field: 'performanceBand', operator: 'contains', value: band });
      break;
    }
  }
  return result;
}
export function hasAnalyticsIntent(p) { return p.intents.some(i => i.type.startsWith('ANALYTICS_')); }
""")
print("Wrote intentParser.js")

# ── File: analyticsEngine.js ──
with open(os.path.join(BASE, "analyticsEngine.js"), "w") as f:
    f.write("""export function analyticsMin(flatIndex, field, filters) {
  let minVal = Infinity, minPk = null;
  for (const rec of flatIndex) {
    if (rec.fieldName !== field) continue;
    if (!passesFilters(rec, filters, flatIndex)) continue;
    const val = parseFloat(rec.content);
    if (isNaN(val)) continue;
    if (val < minVal) { minVal = val; minPk = rec.employeeId; }
  }
  if (!minPk) return null;
  const empRecords = flatIndex.filter(r => r.employeeId === minPk);
  const profileRec = empRecords.find(r => r.sheetName === 'Employee_Profile' && r.fieldName === 'name');
  const titleRec = empRecords.find(r => r.sheetName === 'Employee_Profile' && r.fieldName === 'jobTitle');
  const deptRec = empRecords.find(r => r.sheetName === 'Employee_Profile' && r.fieldName === 'department');
  return {
    employeeId: minPk,
    name: profileRec?.content || 'EMP' + String(minPk).padStart(3,'0'),
    jobTitle: titleRec?.content || '',
    department: deptRec?.content || '',
    value: minVal, field, metric: 'min',
    records: empRecords,
  };
}

export function analyticsMax(flatIndex, field, filters) {
  let maxVal = -Infinity, maxPk = null;
  for (const rec of flatIndex) {
    if (rec.fieldName !== field) continue;
    if (!passesFilters(rec, filters, flatIndex)) continue;
    const val = parseFloat(rec.content);
    if (isNaN(val)) continue;
    if (val > maxVal) { maxVal = val; maxPk = rec.employeeId; }
  }
  if (!maxPk) return null;
  const empRecords = flatIndex.filter(r => r.employeeId === maxPk);
  const profileRec = empRecords.find(r => r.sheetName === 'Employee_Profile' && r.fieldName === 'name');
  const titleRec = empRecords.find(r => r.sheetName === 'Employee_Profile' && r.fieldName === 'jobTitle');
  const deptRec = empRecords.find(r => r.sheetName === 'Employee_Profile' && r.fieldName === 'department');
  return {
    employeeId: maxPk,
    name: profileRec?.content || 'EMP' + String(maxPk).padStart(3,'0'),
    jobTitle: titleRec?.content || '',
    department: deptRec?.content || '',
    value: maxVal, field, metric: 'max',
    records: empRecords,
  };
}

export function filterEmployees(flatIndex, filters) {
  const matched = new Map();
  for (const rec of flatIndex) {
    if (!passesFilters(rec, filters, flatIndex)) continue;
    if (!matched.has(rec.employeeId)) {
      matched.set(rec.employeeId, { employeeId: rec.employeeId, score: 0, matchedFields: new Set(), matchedRecords: [] });
    }
    const entry = matched.get(rec.employeeId);
    entry.score += 1;
    entry.matchedRecords.push(rec);
  }
  return Array.from(matched.values()).sort((a, b) => b.score - a.score).slice(0, 15);
}

function passesFilters(rec, filters, flatIndex) {
  for (const filter of filters) {
    if (filter.field === 'department') {
      const deptRec = flatIndex.find(r => r.employeeId === rec.employeeId && r.sheetName === 'Employee_Profile' && r.fieldName === 'department');
      if (!deptRec || deptRec.content !== filter.value) return false;
      continue;
    }
    if (filter.field === rec.fieldName && filter.sheet && rec.sheetName !== filter.sheet) continue;
    if (filter.field === rec.fieldName) {
      if (filter.operator === 'eq' && rec.content !== filter.value) return false;
      if (filter.operator === 'contains' && !rec.content.toLowerCase().includes(filter.value.toLowerCase())) return false;
      if (filter.operator === 'in' && !filter.value.includes(rec.content)) return false;
    }
  }
  return true;
}
""")
print("Wrote analyticsEngine.js")

# ── Now update searchIndex.js to import and use intent pipeline ──
srch_path = os.path.join(BASE, "searchIndex.js")
with open(srch_path, "r") as f:
    search_js = f.read()

# Add imports at the top
search_js = search_js.replace(
    "// 7 matchers + merge/rank + answer builder",
    "import { parseIntent, hasAnalyticsIntent } from './intentParser.js';\nimport { analyticsMin, analyticsMax, filterEmployees } from './analyticsEngine.js';\n\n// 7 matchers + merge/rank + answer builder"
)

# Replace the export function search to add intent routing
old_search = """export function search(query, { flatIndex, searchIndex }) {
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
}"""

new_search = """export function search(query, { flatIndex, searchIndex }) {
  // LOOP 8: Intent-based analytics search
  const parsed = parseIntent(query);
  
  if (hasAnalyticsIntent(parsed)) {
    const intent = parsed.intents[0];
    let analyticsResult;
    if (intent.type === 'ANALYTICS_MIN') {
      analyticsResult = analyticsMin(flatIndex, intent.field, parsed.filters);
    } else if (intent.type === 'ANALYTICS_MAX') {
      analyticsResult = analyticsMax(flatIndex, intent.field, parsed.filters);
    }
    if (analyticsResult) {
      const results = [{ employeeId: analyticsResult.employeeId, score: 100, matchedFields: [intent.field], matchedRecords: analyticsResult.records }];
      const fieldLabel = intent.field === 'kpiScore' ? 'KPI' : 'OKR';
      const metricLabel = intent.metric === 'min' ? 'lowest (minimum)' : 'highest (maximum)';
      let answer = fieldLabel + ' ' + metricLabel + ':\\n- ' + analyticsResult.name + ' (' + analyticsResult.jobTitle + ') [' + analyticsResult.department + ']\\n  Value: ' + analyticsResult.value + '\\n';
      const bandRec = analyticsResult.records.find(r => r.fieldName === 'performanceBand');
      if (bandRec) answer += '  Performance Band: ' + bandRec.content + '\\n';
      const warnCount = analyticsResult.records.filter(r => r.sheetName === 'Warning_Disciplinary_History').length;
      answer += '  Total Warnings: ' + warnCount;
      return { results, answer, sources: buildSources(results, flatIndex), matchersUsed: ['analytics-' + intent.type] };
    }
  }
  
  // If there are explicit filters but no analytics intent (e.g., "IT KPI below", "training incomplete", "warning high")
  if (parsed.filters.length > 0) {
    const filtered = filterEmployees(flatIndex, parsed.filters);
    if (filtered.length > 0) {
      const results = filtered.map(f => ({ ...f, matchedFields: Array.from(f.matchedFields) }));
      const answer = buildAnswer(query, results);
      return { results, answer, sources: buildSources(results, flatIndex), matchersUsed: ['filter'] };
    }
  }

  // Fallback to existing 7 matchers
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
}"""

search_js = search_js.replace(old_search, new_search)
with open(srch_path, "w") as f:
    f.write(search_js)
print("Updated searchIndex.js with analytics pipeline")

print("\\nAll LOOP 8 files written successfully.")