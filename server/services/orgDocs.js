// orgDocs.js — อ่านไฟล์ระดับองค์กร (master index, dashboards, registries) → chunks
// ไฟล์พวกนี้ไม่ใช่ "พนักงาน" แต่มีข้อมูลภาพรวมบริษัทที่ควรค้นได้ (โปรเจกต์, defect, นโยบาย)
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

const MAX_CHARS = 1200;

function rowToText(rowObj) {
  return Object.entries(rowObj)
    .map(([k, v]) => `${k}: ${String(v ?? '').trim()}`)
    .filter(s => !s.endsWith(': '))
    .join(' | ');
}

function detectHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const nonEmpty = (rows[r] || []).filter(c => String(c ?? '').trim() !== '').length;
    const next = ((rows[r + 1] || []).filter(c => String(c ?? '').trim() !== '')).length;
    if (nonEmpty >= 2 && next >= 1) return r;
  }
  return -1;
}

// dataDir: โฟลเดอร์ที่มีไฟล์ org-level; filePattern: regex ของไฟล์ "พนักงาน" (จะข้าม)
export function orgDocsToChunks(dataDir, employeePattern = '^EMP\\d+') {
  if (!fs.existsSync(dataDir)) return [];
  const empRe = new RegExp(employeePattern, 'i');
  const files = fs.readdirSync(dataDir).filter(f => /\.xlsx$/i.test(f) && !empRe.test(f));
  const chunks = [];

  for (const fileName of files) {
    const docName = fileName.replace(/\.xlsx$/i, '');
    try {
      const wb = xlsx.readFile(path.join(dataDir, fileName));
      for (const sheetName of wb.SheetNames) {
        const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
        const hIdx = detectHeader(rows);
        if (hIdx === -1) continue;
        const headers = (rows[hIdx] || []).map((h, i) => String(h ?? '').trim() || `_col${i}`);
        for (let r = hIdx + 1; r < rows.length; r++) {
          const rowData = rows[r];
          if (!rowData || rowData.every(c => String(c ?? '').trim() === '')) continue;
          const obj = {};
          headers.forEach((h, c) => { const v = String(rowData[c] ?? '').trim(); if (v) obj[h] = v; });
          if (!Object.keys(obj).length) continue;
          let text = `[${docName}] ${sheetName} | ${rowToText(obj)}`;
          if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
          chunks.push({
            id: `orgdoc/${docName}/${sheetName}/${r - hIdx - 1}`,
            text,
            meta: {
              kind: 'orgdoc',
              code: 'ORG',           // ไม่ผูกกับพนักงานคนใด
              name: docName,
              department: '',
              sheet: sheetName,
              sensitivity: /salary|confidential|legal|warning/i.test(docName) ? 'sensitive' : 'standard',
              rowIndex: r - hIdx - 1,
            },
          });
        }
      }
    } catch (e) {
      console.warn(`[orgDocs] skip ${fileName}:`, e.message);
    }
  }
  return chunks;
}
