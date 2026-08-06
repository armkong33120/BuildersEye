// registryIngest.js — แปลง Employee Registry (dynamic) → flatIndex/searchIndex รูปแบบเดิม
// ทำให้ engine เดิมทุกตัว (search/sql/analytics/vector/chat) ใช้ข้อมูลจาก OneDrive ได้ทันที
// โดยไม่ต้องแก้ logic เดิมเลย — ข้อมูลไหล: OneDrive → cache → registry → engines

// sheet → recordType (รู้จักก็ map, ไม่รู้จัก → derive จากชื่อ sheet อัตโนมัติ ไม่ hardcode fail)
const RECORD_TYPE_MAP = {
  'Employee_Profile': 'identity',
  'Career_Timeline': 'career',
  'KPI_OKR_History': 'kpi',
  'Project_History': 'project',
  'Collaboration_Network': 'collaboration',
  'Warning_Disciplinary_History': 'warning',
  'Learning_Development': 'learning',
};

// department → confidentiality (เหมือน ingestExcel เดิม เพื่อไม่ให้ policy พัง)
const CONFIDENTIALITY_MAP = {
  'Executive': 'Tier 1 — Strict',
  'HR & Admin': 'Tier 1 — Strict',
  'Finance & Accounting': 'Tier 1 — Strict',
  'Legal': 'Tier 1 — Strict',
  'IT': 'Tier 2 — Sensitive',
};

export function tokenize(text) {
  if (!text) return [];
  const clean = String(text).toLowerCase().replace(/[^\p{L}\p{N}@._/-]+/gu, ' ').trim();
  return clean.split(/\s+/).filter(t => t.length >= 1);
}

function recordTypeFor(sheetName) {
  return RECORD_TYPE_MAP[sheetName] || sheetName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

// employees: จาก employeeRegistry.getActiveEmployees()
// คืน { flatIndex, searchIndex } หน้าตาเหมือน ingestAll() เป๊ะ
export function registryToFlatIndex(employees) {
  const flatIndex = [];
  const searchIndex = new Map();

  for (const emp of employees) {
    if (emp.status !== 'active') continue;
    const employeeId = emp.pk || 0;
    const confidentiality = CONFIDENTIALITY_MAP[emp.department] || 'Tier 3 — Standard';

    for (const [sheetName, sheetData] of Object.entries(emp.sheets || {})) {
      const recordType = recordTypeFor(sheetName);
      (sheetData.records || []).forEach((rowObj, rowIdx) => {
        for (const [fieldName, value] of Object.entries(rowObj)) {
          const content = String(value ?? '').trim();
          if (!fieldName || content === '') continue;
          const entry = {
            employeeId,
            employeeCode: emp.code,
            employeeName: emp.name,
            department: emp.department,
            sheetName,
            rowNumber: rowIdx + 1,
            fieldName,
            content,
            confidentialityLevel: confidentiality,
            fileName: emp.fileName,
            filePath: '',
            recordType,
          };
          flatIndex.push(entry);
          const idx = flatIndex.length - 1;
          for (const token of tokenize(content)) {
            if (!searchIndex.has(token)) searchIndex.set(token, []);
            searchIndex.get(token).push(idx);
          }
        }
      });
    }
  }

  return { flatIndex, searchIndex };
}

// สร้าง scope chain: Manager เห็นตัวเอง + ลูกน้องทุกชั้น (ผ่าน managerCode)
// คืน null = เห็นทั้งหมด (CEO/HR), หรือ Set ของ code ที่มองเห็น
export function buildScopeCodes(viewer, employees) {
  if (viewer.role === 'CEO' || viewer.role === 'HR') return null;
  const byPk = new Map(employees.map(e => [e.pk, e]));
  const me = byPk.get(Number(viewer.employeeId)) || employees.find(e => e.pk === Number(viewer.employeeId));
  if (!me) return new Set();
  if (viewer.role === 'Employee') return new Set([me.code]);

  // Manager: ตัวเอง + descendants
  const childrenOf = new Map();
  for (const e of employees) {
    if (!e.managerCode) continue;
    const key = String(e.managerCode).toUpperCase();
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(e.code);
  }
  const visible = new Set([me.code]);
  const queue = [me.code];
  while (queue.length) {
    const cur = String(queue.pop()).toUpperCase();
    for (const child of childrenOf.get(cur) || []) {
      if (!visible.has(child)) { visible.add(child); queue.push(child); }
    }
  }
  return visible;
}
