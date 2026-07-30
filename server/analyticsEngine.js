export function analyticsMin(flatIndex, field, filters) {
  const recordsByEmpId = buildRecordsByEmpId(flatIndex);
  let minVal = Infinity, minPk = null;
  for (const [empId, empRecords] of recordsByEmpId) {
    if (!employeePassesFilters(empRecords, filters)) continue;
    for (const rec of empRecords) {
      if (rec.fieldName !== field) continue;
      const val = parseFloat(rec.content);
      if (isNaN(val)) continue;
      if (val < minVal) { minVal = val; minPk = empId; }
    }
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
  const recordsByEmpId = buildRecordsByEmpId(flatIndex);
  let maxVal = -Infinity, maxPk = null;
  for (const [empId, empRecords] of recordsByEmpId) {
    if (!employeePassesFilters(empRecords, filters)) continue;
    for (const rec of empRecords) {
      if (rec.fieldName !== field) continue;
      const val = parseFloat(rec.content);
      if (isNaN(val)) continue;
      if (val > maxVal) { maxVal = val; maxPk = empId; }
    }
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
  const recordsByEmpId = buildRecordsByEmpId(flatIndex);
  const matched = [];

  for (const [empId, empRecords] of recordsByEmpId) {
    if (!employeePassesFilters(empRecords, filters)) continue;

    const entry = { employeeId: empId, score: 0, matchedFields: new Set(), matchedRecords: [] };

    // Collect records that actually match the filter fields
    for (const filter of filters) {
      if (filter.field === 'department') continue; // already checked by employeePassesFilters
      for (const rec of empRecords) {
        if (filter.sheet && rec.sheetName !== filter.sheet) continue;
        if (rec.fieldName !== filter.field) continue;
        let recMatches = false;
        if (filter.operator === 'eq' && rec.content === filter.value) recMatches = true;
        else if (filter.operator === 'contains' && rec.content.toLowerCase().includes(filter.value.toLowerCase())) recMatches = true;
        else if (filter.operator === 'in' && filter.value.includes(rec.content)) recMatches = true;
        if (recMatches) {
          entry.matchedFields.add(rec.sheetName + '.' + rec.fieldName);
          entry.matchedRecords.push(rec);
          entry.score += 5;
        }
      }
    }
    // Also include profile records for context
    for (const rec of empRecords) {
      if (rec.sheetName === 'Employee_Profile' && !entry.matchedRecords.includes(rec)) {
        entry.matchedRecords.push(rec);
      }
    }
    matched.push(entry);
  }

  return matched.sort((a, b) => b.score - a.score).slice(0, 15);
}

function buildRecordsByEmpId(flatIndex) {
  const map = new Map();
  for (const rec of flatIndex) {
    if (!map.has(rec.employeeId)) map.set(rec.employeeId, []);
    map.get(rec.employeeId).push(rec);
  }
  return map;
}

function employeePassesFilters(empRecords, filters) {
  for (const filter of filters) {
    // Department filter: check employee profile
    if (filter.field === 'department') {
      const deptRec = empRecords.find(r => r.sheetName === 'Employee_Profile' && r.fieldName === 'department');
      if (!deptRec || deptRec.content !== filter.value) return false;
      continue;
    }
    // Field filter: check if ANY record of this employee matches
    const matchingRec = empRecords.find(r => {
      if (filter.sheet && r.sheetName !== filter.sheet) return false;
      if (r.fieldName !== filter.field) return false;
      if (filter.operator === 'eq') return r.content === filter.value;
      if (filter.operator === 'contains') return r.content.toLowerCase().includes(filter.value.toLowerCase());
      if (filter.operator === 'in') return filter.value.includes(r.content);
      return false;
    });
    if (!matchingRec) return false;
  }
  return true;
}