const DEPT_ALIASES = {
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
  const tokens = ql.split(/\s+/).filter(Boolean);
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
  const em = ql.match(/\bemp(\d{1,3})\b/i);
  if (em) { result.intents.push({ type: 'EXACT_EMPLOYEE', pk: parseInt(em[1]) }); result.confidence = 1.0; }
  if (/training.*(incomplete|not complete)/i.test(ql))
    result.filters.push({ field: 'completionStatus', operator: 'eq', value: 'Incomplete', sheet: 'Learning_Development' });
  if (/formal\s*warning/i.test(ql))
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
