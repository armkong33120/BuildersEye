// export สำหรับ template redaction (searchIndex.js ใช้ตรวจ canSeeWarnings/canSeeCompensation)
export const VIEWER_ROLES = {
  CEO: { canSeeAll: true, canSeeSensitive: true, canSeeCompensation: true, canSeeWarnings: true, scope: 'ALL' },
  HR: { canSeeAll: false, canSeeSensitive: true, canSeeCompensation: true, canSeeWarnings: true, scope: 'HR_RECORDS' },
  Manager: { canSeeAll: false, canSeeSensitive: false, canSeeCompensation: false, canSeeWarnings: true, scope: 'SUBTREE' },
  Employee: { canSeeAll: false, canSeeSensitive: false, canSeeCompensation: false, canSeeWarnings: false, scope: 'SELF' },
};

export const SENSITIVE_FIELDS = {
  'Employee_Profile': ['mainWeakness', 'retentionRisk', 'successionPotential'],
};

// ── Compensation-sensitive terms (Thai + English) ────────────────────────────
const COMPENSATION_TERMS = /salary|compensation|bonus|incentive|ค่าจ้าง|เงินเดือน|โบนัส|ค่าตอบแทน/i;
// Team-scoped aggregate wording (Manager may see team aggregate only)
const TEAM_AGGREGATE_TERMS = /เฉลี่ย|รวม|ทั้งหมด|ทีม|ลูกทีม|ทีมฉัน|ทีมงาน|ของทีม|ของฉัน|ของผม|average|sum|total/i;
// Individual-target wording (blocked for Manager when compensation is involved)
const INDIVIDUAL_TARGET_TERMS = /EMP\s*\d{1,3}|CEO|CFO|COO|ของ\s*EMP/i;
// Company-wide wording (Manager may NOT see company-wide compensation aggregates)
const COMPANY_WIDE_TERMS = /ทั้งบริษัท|ทั้งองค์กร|ทุกคน|ทั้งแผนก/i;

export function checkQueryPolicy(query, viewerRole) {
  if (viewerRole === 'CEO' || viewerRole === 'HR') return { status: 'Allowed' };

  // Employee: fully blocked from all compensation/bonus/salary queries
  // (including self-access — matches the existing blunt salary behavior).
  if (viewerRole === 'Employee') {
    if (COMPENSATION_TERMS.test(query)) {
      return { status: 'Blocked', reason: 'Query blocked by governance policy for ' + viewerRole + ' role.' };
    }
    return { status: 'Allowed' };
  }

  // Manager: blocked from individual compensation and company-wide aggregates,
  // but allowed a team-scoped aggregate (enforced downstream via SQL scope).
  if (viewerRole === 'Manager') {
    if (!COMPENSATION_TERMS.test(query)) return { status: 'Allowed' };
    const isTeamAggregate = TEAM_AGGREGATE_TERMS.test(query);
    const isIndividual = INDIVIDUAL_TARGET_TERMS.test(query);
    const isCompanyWide = COMPANY_WIDE_TERMS.test(query);
    if (isTeamAggregate && !isIndividual && !isCompanyWide) return { status: 'Allowed' };
    return { status: 'Blocked', reason: 'Query blocked by governance policy for ' + viewerRole + ' role.' };
  }

  return { status: 'Allowed' };
}

// @deprecated — delegates to the canonical resolver (legacyResolveScope) so the
// keyword/vector post-filter shares ONE scope boundary with SQL/vector pre-filter.
import { legacyResolveScope } from './access/scopeResolver.js';

export function resolveScope(viewerRole, viewerPk, targetPk, identityGraph) {
  return legacyResolveScope(viewerRole, viewerPk, targetPk, identityGraph);
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
