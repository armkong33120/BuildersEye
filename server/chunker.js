// chunker.js — แปลง registry employees → semantic chunks (ตาม RAG best practice: row-level + metadata)
// 1 chunk = 1 แถว Excel → text อ่านง่าย + metadata ครบสำหรับ filter/RBAC
const MAX_CHUNK_CHARS = 1200; // ~512 tokens (safe สำหรับ e5-small)

function rowToText(sheetName, rowObj) {
  const parts = [];
  for (const [k, v] of Object.entries(rowObj)) {
    const s = String(v ?? '').trim();
    if (s !== '') parts.push(`${k}: ${s}`);
  }
  return parts.join(' | ');
}

// employees: จาก registry; schema.sheets มี sensitivity ต่อ sheet
export function employeesToChunks(employees, schema) {
  const chunks = [];
  for (const emp of employees) {
    if (emp.status !== 'active') continue;
    for (const [sheetName, sheetData] of Object.entries(emp.sheets || {})) {
      const sensitivity = schema?.sheets?.[sheetName]?.sensitivity || 'standard';
      (sheetData.records || []).forEach((rowObj, rowIdx) => {
        let text = `${emp.name} | ${emp.department} | ${sheetName} | ${rowToText(sheetName, rowObj)}`;
        if (text.length > MAX_CHUNK_CHARS) text = text.slice(0, MAX_CHUNK_CHARS);
        chunks.push({
          id: `${emp.code}/${sheetName}/${rowIdx}`,
          text,
          meta: {
            code: emp.code,
            pk: emp.pk,
            name: emp.name,
            department: emp.department,
            sheet: sheetName,
            sensitivity,
            rowIndex: rowIdx,
          },
        });
      });
    }
  }
  return chunks;
}
