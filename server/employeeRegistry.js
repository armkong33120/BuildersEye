// employeeRegistry.js — Dynamic Employee Data Layer (ก่อนเชื่อม LLM)
// หลักการ: "ไฟล์คือความจริง" — อ่าน Excel แบบ dynamic ทุก sheet/คอลัมน์ ไม่ hardcode schema
// รองรับ: คอลัมน์เพิ่ม / แถวเพิ่ม / sheet เพิ่ม / คนเข้า (ไฟล์ใหม่) / คนออก (ไฟล์หาย)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = path.join(__dirname, '.data', 'registry');
const EMPLOYEES_FILE = path.join(REGISTRY_DIR, 'employees.json');
const SCHEMA_FILE = path.join(REGISTRY_DIR, 'schema.json');

if (!fs.existsSync(REGISTRY_DIR)) fs.mkdirSync(REGISTRY_DIR, { recursive: true });

// --- Identity key candidates: "ชื่อ field ที่น่าจะเป็น..." (ขยายได้โดยไม่แก้ logic) ---
// ถ้าอนาคตไฟล์ใช้ชื่ออื่น เพิ่ม candidate ตรงนี้จุดเดียว
const IDENTITY_CANDIDATES = {
  pk: ['pk', 'employeeId', 'employee_id', 'id', 'empId', 'emp_id', 'no'],
  code: ['code', 'employeeCode', 'employee_code', 'empCode', 'emp_code', 'staffId'],
  name: ['name', 'employeeName', 'employee_name', 'fullName', 'full_name', 'displayName'],
  department: ['department', 'dept', 'division', 'team', 'unit'],
  jobTitle: ['jobTitle', 'job_title', 'title', 'position', 'role'],
  roleGroup: ['roleGroup', 'role_group', 'group', 'level', 'band'],
  managerCode: ['managerCode', 'manager_code', 'manager', 'reportsTo', 'reports_to', 'supervisorCode'],
  managerName: ['managerName', 'manager_name', 'supervisorName', 'supervisor'],
  email: ['email', 'mail', 'emailAddress', 'workEmail'],
  status: ['status', 'employmentStatus', 'employment_status', 'employeeStatus', 'active'],
};

// ไฟล์ที่จะถือเป็น "พนักงาน" — data contract ประกาศไว้จุดเดียว ปรับได้ผ่าน env
// (ไฟล์ org-level เช่น master index / dashboard จะถูกข้ามและบันทึกไว้ใน stats.skippedFiles)
const EMPLOYEE_FILE_PATTERN = process.env.REGISTRY_FILE_PATTERN || '^EMP\\d+';

// field names ที่บ่งบอกความลับ (heuristic — เพิ่มคำได้โดยไม่แก้ logic)
const SENSITIVE_HINTS = ['salary', 'wage', 'bonus', 'compensation', 'เงินเดือน', 'warning', 'disciplinary', 'grievance', 'case', 'confidential'];

function normalizeKey(k) {
  return String(k || '').trim().replace(/[\s_\-]+/g, '').toLowerCase();
}

// map header จริง → identity field (เทียบแบบ normalize)
function resolveIdentityField(profileRow) {
  const byNorm = new Map(Object.keys(profileRow).map(k => [normalizeKey(k), k]));
  const out = {};
  for (const [field, candidates] of Object.entries(IDENTITY_CANDIDATES)) {
    for (const cand of candidates) {
      const hit = byNorm.get(normalizeKey(cand));
      if (hit !== undefined && profileRow[hit] !== '' && profileRow[hit] != null) {
        out[field] = profileRow[hit];
        break;
      }
    }
  }
  return out;
}

// หา header row แบบ dynamic: แถวแรกที่มี >=2 เซลล์ไม่ว่าง และแถวถัดไปมีข้อมูลรองรับ
function detectHeaderRowIndex(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const nonEmpty = (rows[r] || []).filter(c => String(c ?? '').trim() !== '').length;
    const nextNonEmpty = ((rows[r + 1] || []).filter(c => String(c ?? '').trim() !== '')).length;
    if (nonEmpty >= 2 && nextNonEmpty >= 1) return r;
  }
  return -1;
}

// parse sheet แบบ generic → array ของ object (คอลัมน์อะไรก็รับ)
function parseSheetDynamic(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const hIdx = detectHeaderRowIndex(rows);
  if (hIdx === -1) return { headers: [], records: [] };
  const headers = (rows[hIdx] || []).map((h, i) => {
    const name = String(h ?? '').trim();
    return name || `_col${i}`; // คอลัมน์ไม่มีหัวแต่มีข้อมูล → เก็บไว้ไม่ให้หาย
  });
  const records = [];
  for (let r = hIdx + 1; r < rows.length; r++) {
    const rowData = rows[r];
    if (!rowData || rowData.every(c => String(c ?? '').trim() === '')) continue;
    const obj = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      const v = rowData[c];
      if (String(v ?? '').trim() !== '') { obj[headers[c]] = v; hasValue = true; }
    }
    if (hasValue) records.push(obj);
  }
  return { headers: headers.filter(h => !h.startsWith('_col')), records };
}

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 16);
}

function guessSensitivity(sheetName, headers) {
  const hay = (sheetName + ' ' + headers.join(' ')).toLowerCase();
  return SENSITIVE_HINTS.some(h => hay.includes(h.toLowerCase())) ? 'sensitive' : 'standard';
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}

// ============================= MAIN BUILD =============================
// scan cacheDir → rebuild registry แบบ incremental (ข้ามไฟล์ที่ hash ไม่เปลี่ยน)
export function buildRegistry(cacheDir, { force = false } = {}) {
  const prevEmployees = loadJson(EMPLOYEES_FILE, {});
  const prevSchema = loadJson(SCHEMA_FILE, { sheets: {}, updatedAt: null });

  const files = fs.existsSync(cacheDir)
    ? fs.readdirSync(cacheDir).filter(f => /\.xlsx$/i.test(f))
    : [];

  const now = new Date().toISOString();
  const seenCodes = new Set();
  const stats = { filesSeen: files.length, reparsed: 0, skippedUnchanged: 0, added: 0, removed: 0, newColumns: [], newSheets: [], skippedFiles: [] };
  const employees = { ...prevEmployees };
  const schema = prevSchema;
  const filePattern = new RegExp(EMPLOYEE_FILE_PATTERN, 'i');
  // snapshot schema เดิมก่อน mutate (ไว้รายงาน column/sheet ที่ "เพิ่งโผล่มา" จริงๆ)
  const prevSheetNames = new Set(Object.keys(prevSchema.sheets || {}));
  const prevColumns = new Map(
    Object.entries(prevSchema.sheets || {}).map(([s, d]) => [s, new Set(Object.keys(d.columns || {}))])
  );

  // ---- 1) เพิ่ม/อัปเดต จากไฟล์ที่มีอยู่ ----
  for (const fileName of files) {
    const filePath = path.join(cacheDir, fileName);
    const codeMatch = fileName.match(filePattern);
    if (!codeMatch) { stats.skippedFiles.push(fileName); continue; } // ไฟล์ org-level ไม่ใช่พนักงาน
    const hash = fileHash(filePath);
    const codeFromFile = codeMatch[0].toUpperCase();
    seenCodes.add(codeFromFile);

    const existing = employees[codeFromFile];
    if (!force && existing && existing.fileHash === hash) { stats.skippedUnchanged++; continue; }

    const workbook = xlsx.readFile(filePath);
    const sheets = {};
    let identity = {};
    let profileHeaders = [];

    for (const sheetName of workbook.SheetNames) {
      const { headers, records } = parseSheetDynamic(workbook.Sheets[sheetName]);
      if (records.length === 0) continue;
      sheets[sheetName] = { headers, records };

      // --- schema registry: union คอลัมน์ (คอลัมน์ใหม่ → เพิ่มอัตโนมัติ) ---
      if (!schema.sheets[sheetName]) {
        schema.sheets[sheetName] = { columns: {}, sensitivity: guessSensitivity(sheetName, headers), firstSeen: now };
        if (prevSheetNames.size > 0 && !prevSheetNames.has(sheetName)) stats.newSheets.push(sheetName);
      }
      for (const h of headers) {
        if (!schema.sheets[sheetName].columns[h]) {
          schema.sheets[sheetName].columns[h] = { firstSeen: now, seenIn: 1 };
          if (prevColumns.has(sheetName) && !prevColumns.get(sheetName).has(h)) stats.newColumns.push(sheetName + '.' + h);
        } else {
          schema.sheets[sheetName].columns[h].seenIn++;
        }
      }

      // identity: sheet ไหนก็ได้ที่มี pk/code+name (ไม่จำกัดชื่อ sheet)
      if (Object.keys(identity).length === 0 && records.length > 0) {
        const resolved = resolveIdentityField(records[0]);
        if (resolved.name || resolved.pk || resolved.code) {
          identity = resolved;
          profileHeaders = headers;
        }
      }
    }

    // guard: ไฟล์ผ่าน pattern แต่ content ไม่มี identity เลย → ข้าม (กันไฟล์เสีย/ผิดฟอร์แมต)
    if (!identity.name && !identity.pk && !existing) {
      stats.skippedFiles.push(fileName + ' (no identity)');
      seenCodes.delete(codeFromFile);
      continue;
    }

    const isNew = !existing;
    const isRehire = existing && existing.status === 'removed';
    if (isNew) stats.added++;
    if (isRehire) stats.reactivated = (stats.reactivated || 0) + 1;
    stats.reparsed++;

    employees[codeFromFile] = {
      code: identity.code || codeFromFile,
      pk: Number(identity.pk) || existing?.pk || null,
      name: identity.name || existing?.name || '',
      department: identity.department || existing?.department || '',
      jobTitle: identity.jobTitle || existing?.jobTitle || '',
      roleGroup: identity.roleGroup || existing?.roleGroup || '',
      managerCode: identity.managerCode || existing?.managerCode || '',
      managerName: identity.managerName || existing?.managerName || '',
      email: identity.email || existing?.email || '',
      employmentStatus: String(identity.status || existing?.employmentStatus || 'active'),
      status: 'active',
      fileName,
      fileHash: hash,
      sheetNames: Object.keys(sheets),
      profileHeaders,
      rowCounts: Object.fromEntries(Object.entries(sheets).map(([s, d]) => [s, d.records.length])),
      sheets,
      firstSeen: existing?.firstSeen || now,
      lastSeen: now,
      version: (existing?.version || 0) + 1,
    };
  }

  // ---- 2) คนออก: ไฟล์หาย → tombstone (เก็บ metadata ไว้ ลบข้อมูลดิบเพื่อ privacy) ----
  for (const [code, emp] of Object.entries(employees)) {
    if (!seenCodes.has(code) && emp.status !== 'removed') {
      emp.status = 'removed';
      emp.removedAt = now;
      emp.sheets = {};
      stats.removed++;
    }
  }

  schema.updatedAt = now;
  fs.writeFileSync(EMPLOYEES_FILE, JSON.stringify(employees, null, 1), 'utf-8');
  fs.writeFileSync(SCHEMA_FILE, JSON.stringify(schema, null, 1), 'utf-8');

  const active = Object.values(employees).filter(e => e.status === 'active');
  return {
    ...stats,
    totalTracked: Object.keys(employees).length,
    activeEmployees: active.length,
    sheetsKnown: Object.keys(schema.sheets).length,
    employeesFile: EMPLOYEES_FILE,
    schemaFile: SCHEMA_FILE,
  };
}

// ---- Query helpers (ชั้นที่ backend/LLM จะใช้ต่อไป) ----
export function getActiveEmployees() {
  const employees = loadJson(EMPLOYEES_FILE, {});
  return Object.values(employees).filter(e => e.status === 'active');
}

export function getEmployee(codeOrPk) {
  const employees = loadJson(EMPLOYEES_FILE, {});
  const key = String(codeOrPk).toUpperCase();
  return employees[key]
    || Object.values(employees).find(e => String(e.pk) === String(codeOrPk))
    || null;
}

export function getSchema() {
  return loadJson(SCHEMA_FILE, { sheets: {}, updatedAt: null });
}

export function getRegistryDir() { return REGISTRY_DIR; }
