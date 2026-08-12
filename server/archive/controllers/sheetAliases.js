// sheetAliases.js — bilingual alias map สำหรับ sheet-mention detection (Layer 2)
// ใช้ detect ว่า query กล่าวถึง sheet ไหน → sheetBias + coverage guarantee
// deterministic (ไม่ hardcode ต่อคำถาม) — เดียวกับ whoBias pattern

const SHEET_ALIASES = {
  'Expense_Reports': ['expense', 'ค่าใช้จ่าย', 'เบิกเงิน', 'เบิกจ่าย', 'travel', 'ค่าเดินทาง', 'entertainment', 'ค่าบันเทิง', 'office supplies', 'ค่าใช้จ่ายสำนักงาน'],
  'Benefit_Claims': ['benefit', 'สวัสดิการ', 'ผลประโยชน์', 'ประกัน', 'medical', 'ค่ารักษาพยาบาล', 'dental', 'ค่าทันตกรรม', 'wellness', 'ค่าวิทยุรักษ์'],
  'Salary_History': ['salary', 'เงินเดือน', 'ค่าจ้าง', 'base salary', 'โบนัส', 'bonus', 'ขึ้นเงินเดือน', 'increase'],
  'Grievance_Log': ['grievance', 'complaint', 'ร้องเรียน', 'ร้องทุกข์', 'ข้อร้องเรียน'],
  'Warning_Disciplinary_History': ['warning', 'disciplinary', 'ใบเตือน', 'ตักเตือน', 'วินัย', 'formal warning'],
  'KPI_OKR_History': ['kpi', 'okr', 'ผลการประเมิน', 'performance band', 'เป้าหมาย'],
  'Attendance_Record': ['attendance', 'ลาป่วย', 'ลากิจ', 'sick leave', 'personal leave', 'มาสาย', 'late arrival'],
  'Employee_Engagement': ['engagement', 'enps', 'burnout', 'ความผูกพัน', 'หมดไฟ', 'ความเสี่ยง'],
  'Succession_Planning': ['succession', 'flight risk', 'ลาออก', 'การสืบทอดตำแหน่ง', 'readiness'],
  'Collaboration_Network': ['collaboration', 'collaborator', 'ความร่วมมือ', 'ทำงานร่วมกัน', 'ทำงานกับ'],
  'Project_History': ['project', 'โปรเจกต์', 'โปรเจกต์ทั้งหมด', 'โครงการ', 'โครงการทั้งหมด', 'budget', 'งบประมาณ'],
  'Learning_Development': ['training', 'learning', 'อบรม', 'ฝึกอบรม', 'พัฒนาทักษะ'],
  'Career_Timeline': ['career', 'timeline', 'ประวัติการทำงาน', 'promotion', 'เลื่อนตำแหน่ง'],
  'IT_Asset_Register': ['notebook', 'laptop', 'asset', 'อุปกรณ์', 'คอมพิวเตอร์', 'it asset'],
  'IT_Ticket_Log': ['ticket', 'it support', 'แจ้งซ่อม', 'ปัญหาไอที', 'helpdesk'],
  'Software_Licenses': ['license', 'ซอฟต์แวร์', 'ลิขสิทธิ์', 'software'],
  '360_Feedback': ['feedback', '360', 'ฟีดแบ็ก', 'ความคิดเห็น', 'review'],
  'Skill_Matrix': ['skill', 'ทักษะ', 'ภาษา', 'ielts', 'certification', 'ใบเซอร์'],
  'Compliance_Mandates': ['compliance', 'pdpa', 'กฎระเบียบ', 'ข้อบังคับ', 'mandate'],
  'Onboarding_Journey': ['onboarding', 'การรับเข้า', 'สัมภาษณ์', 'interview', 'culture fit'],
  'Physical_Security': ['access', 'badge', 'การ์ด', 'เข้าตึก', 'parking', 'ที่จอดรถ', 'security'],
  'Timesheet_Log': ['timesheet', 'billable', 'ชั่วโมงทำงาน', 'admin hours'],
  'Employee_Profile': ['profile', 'ประวัติพนักงาน', 'ข้อมูลส่วนตัว'],
  'Product_Catalog': ['product', 'สินค้า', 'catalog'],
  'Revenue_By_Product': ['revenue', 'รายได้', 'ยอดขาย', 'margin', 'กำไร', 'profit'],
  'Customer_Portfolio': ['customer', 'ลูกค้า', 'contract', 'สัญญา'],
  'Department_PnL': ['pnl', 'p&l', 'กำไรแผนก', 'net profit', 'headcount cost'],
  'Sales_Pipeline': ['pipeline', 'deal', 'ดีล', 'ปิดการขาย', 'sales'],
  'Operating_Expenses': ['operating expense', 'ค่าเช่า', 'ค่าไฟ', 'ค่าโฆษณา', 'rent', 'utilities', 'ค่าใช้จ่ายดำเนินงาน'],
};

// เตรียม lowercase tokens ครั้งเดียว (ใช้ซ้ำทุก query)
const SEARCH_INDEX = [];
for (const [sheet, aliases] of Object.entries(SHEET_ALIASES)) {
  for (const a of aliases) {
    SEARCH_INDEX.push({ sheet, token: a.toLowerCase() });
  }
}

// คืน Set ของ sheets ที่ query กล่าวถึง (sheet-mention detection)
export function detectSheetMentions(query) {
  if (!query) return new Set();
  const ql = ' ' + String(query).toLowerCase() + ' ';
  const found = new Set();
  for (const { sheet, token } of SEARCH_INDEX) {
    // token ที่เป็นตัวเลข/คำสั้น ใช้ word-boundary; ภาษาไทยใช้ includes (ไม่มี space)
    if (ql.includes(token)) found.add(sheet);
  }
  return found;
}

// ค่าปรับ boost ต่อ sheet — ใช้ร่วมกับ env RAG_SHEET_BOOST
export const DEFAULT_SHEET_BOOST = 1.10;
