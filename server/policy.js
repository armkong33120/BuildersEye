const VIEWER_ROLES = {
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
