// chunker.js — แปลง registry employees → semantic chunks (row-level + metadata)
//
// Layer 1 (Tabular-to-Text enrichment) — แก้ "Dataset Drowning":
//  - Bilingual template: ป้ายภาษาไทย + sheet alias ในทุก chunk (e5-small multilingual)
//  - Summary chunks (1/คน/sheet): ประโยคธรรมชาติ ไม่ใช่ตัวเลขดิบ
//  - Roll-up chunks (1/แผนก/sheet): สรุปรวมแผนก — ตรงกับคำถาม cross-doc
//  - meta.kind: 'row' | 'summary' | 'rollup'
const MAX_CHUNK_CHARS = 1200;

const SHEET_LABELS = {
  'Expense_Reports': 'ค่าใช้จ่าย ค่าเดินทาง เบิกเงิน Expense',
  'Benefit_Claims': 'สวัสดิการ ผลประโยชน์ ประกัน เบิกค่ารักษาพยาบาล Benefit',
  'Salary_History': 'เงินเดือน ค่าจ้าง ฐานเงินเดือน Salary',
  'Grievance_Log': 'เรื่องร้องเรียน ร้องทุกข์ ข้อร้องเรียน Grievance Complaint',
  'Warning_Disciplinary_History': 'ใบเตือน ทางวินัย ตักเตือน Warning Disciplinary',
  'KPI_OKR_History': 'ผลการประเมิน KPI OKR เป้าหมาย',
  'Attendance_Record': 'การลา ลาป่วย ลากิจ มาสาย Attendance',
  'Employee_Engagement': 'ความผูกพัน eNPS burnout ความเสี่ยงหมดไฟ Engagement',
  'Succession_Planning': 'การสืบทอดตำแหน่ง เสี่ยงลาออก Flight Risk Succession',
  'Collaboration_Network': 'ความร่วมมือ การทำงานร่วมกัน Collaboration',
  'Project_History': 'โปรเจกต์ โครงการ Project',
  'Learning_Development': 'อบรม พัฒนา ฝึกอบรม Training Learning',
  'Career_Timeline': 'ประวัติการทำงาน อาชีพ Career',
  'IT_Asset_Register': 'อุปกรณ์ไอที คอมพิวเตอร์ notebook IT Asset',
  'IT_Ticket_Log': 'แจ้งซ่อมไอที ปัญหา Ticket IT Support',
  'Software_Licenses': 'ลิขสิทธิ์ซอฟต์แวร์ Software License',
  '360_Feedback': 'ฟีดแบ็ก 360 ความคิดเห็น Feedback',
  'Skill_Matrix': 'ทักษะ ความสามารถ ภาษา Skill',
  'Compliance_Mandates': 'กฎระเบียบ ข้อบังคับ compliance PDPA',
  'Onboarding_Journey': 'การรับเข้า อบรมแรกเข้า Onboarding',
  'Physical_Security': 'การเข้างาน การ์ด บัตร Access Security',
  'Timesheet_Log': 'ชั่วโมงทำงาน Billable Timesheet',
};

const FIELD_LABELS = {
  'Travel_THB': 'ค่าเดินทาง', 'Entertainment_THB': 'ค่าบันเทิง', 'Office_Supplies_THB': 'ค่าใช้จ่ายสำนักงาน',
  'Dental_THB': 'ค่าทันตกรรม', 'Medical_THB': 'ค่ารักษาพยาบาล', 'Wellness_THB': 'ค่าวิทยุรักษ์สุขภาพ/ออกกำลังกาย',
  'Base_Salary': 'เงินเดือนฐาน', 'Bonus_Months': 'โบนัส(เดือน)', 'Increase_Percent': 'เปอร์เซ็นต์ขึ้นเงินเดือน',
  'Sick_Leave_Days': 'ลาป่วย(วัน)', 'Personal_Leave_Days': 'ลากิจ(วัน)', 'Late_Arrivals': 'มาสาย(ครั้ง)',
};

function fieldParts(fieldName) {
  const th = FIELD_LABELS[fieldName];
  if (th) return { th, en: fieldName.replace('_THB', '') };
  return { th: fieldName.replace(/_/g, ' '), en: fieldName };
}

function rowToText(sheetName, rowObj) {
  const parts = [];
  for (const [k, v] of Object.entries(rowObj)) {
    const s = String(v ?? '').trim();
    if (s === '') continue;
    const { th } = fieldParts(k);
    parts.push(`${th} ${k}: ${s}`);
  }
  return parts.join(' | ');
}

function sheetLabel(sheetName) {
  return SHEET_LABELS[sheetName] ? ` [${SHEET_LABELS[sheetName]}]` : '';
}

function truncate(text) {
  return text.length > MAX_CHUNK_CHARS ? text.slice(0, MAX_CHUNK_CHARS) : text;
}

function makeSummaryChunk(emp, sheetName, rowObj, sensitivity, rowIdx) {
  const label = SHEET_LABELS[sheetName];
  const parts = [];
  for (const [k, v] of Object.entries(rowObj)) {
    const s = String(v ?? '').trim();
    if (s === '' || isNaN(Number(s))) continue;
    const { th, en } = fieldParts(k);
    parts.push(`${th} (${en}) ${Number(s).toLocaleString('th-TH')} บาท`);
  }
  if (!parts.length) return null;
  const text = `${emp.name} แผนก ${emp.department} — สรุป${label || sheetName}: ${parts.join(', ')}`;
  return {
    id: `${emp.code}/${sheetName}/summary/${rowIdx}`,
    text: truncate(text),
    meta: { code: emp.code, pk: emp.pk, name: emp.name, department: emp.department, sheet: sheetName, sensitivity, rowIndex: rowIdx, kind: 'summary' },
  };
}

function makeRollupChunk(dept, sheetName, rows, sensitivity) {
  const sums = {};
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      const n = Number(v);
      if (!isNaN(n)) sums[k] = (sums[k] || 0) + n;
    }
  }
  const label = SHEET_LABELS[sheetName];
  const parts = [];
  for (const [k, v] of Object.entries(sums)) {
    const { th, en } = fieldParts(k);
    parts.push(`${th} (${en}) ${Number(v).toLocaleString('th-TH')} บาท`);
  }
  if (!parts.length) return null;
  const people = new Set(rows.map(r => r._pk)).size;
  const text = `แผนก ${dept} — สรุป${label || sheetName}รวม ${people} คน: ${parts.join(', ')}`;
  return {
    id: `dept:${dept}/${sheetName}/rollup`,
    text: truncate(text),
    meta: { code: `DEPT:${dept}`, pk: 0, name: `แผนก ${dept}`, department: dept, sheet: sheetName, sensitivity, rowIndex: -1, kind: 'rollup', dept: true },
  };
}


// employees: จาก registry; schema.sheets มี sensitivity ต่อ sheet
export function employeesToChunks(employees, schema) {
  const chunks = [];
  const rollupSheets = new Set([
    'Expense_Reports', 'Benefit_Claims', 'Salary_History', 'Attendance_Record',
    'Project_History', 'KPI_OKR_History', 'Warning_Disciplinary_History',
    'IT_Asset_Register', 'Software_Licenses', 'Grievance_Log', 'Employee_Engagement',
    'Succession_Planning', 'Skill_Matrix', 'Collaboration_Network',
  ]);
  const perDeptRows = {};

  for (const emp of employees) {
    if (emp.status !== 'active') continue;
    // 1:many — ingest EVERY source file owned by this employee (backward
    // compatible with pre-multi-file records that only had emp.sheets).
    const fileList = (emp.files && emp.files.length)
      ? emp.files
      : [{ fileName: emp.fileName || '', sheets: emp.sheets || {} }];

    for (const file of fileList) {
      const fileLabel = file.fileName || emp.fileName || 'default';
      for (const [sheetName, sheetData] of Object.entries(file.sheets || {})) {
        const sensitivity = schema?.sheets?.[sheetName]?.sensitivity || 'standard';
        const records = sheetData.records || [];

        records.forEach((rowObj, rowIdx) => {
          // 1a. row chunk — bilingual template
          const text = `${emp.name} | ${emp.department} | ${sheetName}${sheetLabel(sheetName)} | ${rowToText(sheetName, rowObj)}`;
          chunks.push({
            id: `${emp.code}/${fileLabel}/${sheetName}/${rowIdx}`,
            text: truncate(text),
            meta: { code: emp.code, pk: emp.pk, name: emp.name, department: emp.department, sheet: sheetName, sensitivity, rowIndex: rowIdx, kind: 'row', sourceFile: fileLabel },
          });
        });

        // 1b. summary chunk (1 ต่อคน) — สำหรับ numeric sheets
        records.forEach((rowObj, rowIdx) => {
          const s = makeSummaryChunk(emp, sheetName, rowObj, sensitivity, rowIdx);
          if (s) chunks.push(s);
        });

        // เก็บ rows สำหรับ roll-up (planning ต่อแผนก)
        if (rollupSheets.has(sheetName) && records.length > 0) {
          const key = `${emp.department}|${sheetName}`;
          if (!perDeptRows[key]) perDeptRows[key] = { dept: emp.department, sheet: sheetName, rows: [] };
          for (const row of records) perDeptRows[key].rows.push({ ...row, _pk: emp.pk });
        }
      }
    }
  }

  // 1c. roll-up chunks (1 ต่อแผนกต่อ sheet)
  for (const { dept, sheet, rows } of Object.values(perDeptRows)) {
    const sensitivity = schema?.sheets?.[sheet]?.sensitivity || 'standard';
    const r = makeRollupChunk(dept, sheet, rows, sensitivity);
    if (r) chunks.push(r);
  }

  return chunks;
}

