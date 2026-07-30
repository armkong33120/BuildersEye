import xlsx from 'xlsx';
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
  const clean = String(text).toLowerCase().replace(/[^\p{L}\p{N}@._/-]+/gu, ' ').trim();
  return clean.split(/\s+/).filter(t => t.length >= 1);
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
  const files = fs.readdirSync(dataDir).filter(f => /^EMP\d{3}.*\.xlsx$/i.test(f));
  if (files.length === 0) throw new Error('No EMP*.xlsx files found in ' + dataDir);

  for (const fileName of files) {
    const filePath = path.join(dataDir, fileName);
    const workbook = xlsx.readFile(filePath);
    const code = fileName.match(/EMP\d{3}/i)?.[0] || fileName.replace('.xlsx', '');

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
