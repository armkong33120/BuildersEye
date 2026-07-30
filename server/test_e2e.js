import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
let passed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

// =====================================================
// PHASE 1: Static Analysis (System Prompt Validation)
// =====================================================
console.log('\n📋 PHASE 1: System Prompt Validation (Static Analysis)\n');

// 1a. semanticParser.js must contain "TEXT_TO_SQL" in schema
const semParserPath = path.join(__dirname, 'semanticParser.js');
const semParserSrc = fs.readFileSync(semParserPath, 'utf8');
assert(
  semParserSrc.includes('TEXT_TO_SQL'),
  'semanticParser.js contains "TEXT_TO_SQL" in JSON schema'
);

// 1b. sqlEngine.js must contain all 23 sheet names
const sqlEnginePath = path.join(__dirname, 'sqlEngine.js');
const sqlEngineSrc = fs.readFileSync(sqlEnginePath, 'utf8');
const requiredSheets = [
  'Employee_Profile', 'Career_Timeline', 'KPI_OKR_History',
  'Project_History', 'Collaboration_Network', 'Warning_Disciplinary_History',
  'Learning_Development', 'IT_Asset_Register', 'IT_Ticket_Log',
  'Software_Licenses', 'Salary_History', 'Attendance_Record',
  '360_Feedback', 'Skill_Matrix', 'Succession_Planning',
  'Benefit_Claims', 'Expense_Reports', 'Grievance_Log',
  'Compliance_Mandates', 'Onboarding_Journey', 'Employee_Engagement',
  'Physical_Security', 'Timesheet_Log',
  'Product_Catalog', 'Revenue_By_Product', 'Customer_Portfolio', 
  'Department_PnL', 'Sales_Pipeline', 'Operating_Expenses'
];
for (const sheet of requiredSheets) {
  assert(
    sqlEngineSrc.includes(sheet),
    `sqlEngine.js contains sheet "${sheet}"`
  );
}

// 1c. semanticParser.js must list all 29 sheets for LLM awareness
for (const sheet of requiredSheets) {
  assert(
    semParserSrc.includes(sheet),
    `semanticParser.js contains sheet "${sheet}" in Available Database Sheets`
  );
}

// 1d. semanticParser.js must contain new HCM and Business keywords
const hcmKeywords = ['เบิกเงิน', 'ค่าเดินทาง', 'Burnout', 'ลาออก', 'ทักษะ', 'ภาษา', 'ร้องเรียน', 'เข้าตึก', 'ใบเซอร์', 'PDPA', 'eNPS', 'ผลสำรวจ', 'สัมภาษณ์', 'ที่จอดรถ',
'สินค้า', 'รายได้', 'ลูกค้า', 'ดีล', 'กำไร', 'งบประมาณ', 'ค่าเช่า', 'ค่าไฟ', 'ค่าน้ำ', 'ค่าน้ำมัน'];
for (const kw of hcmKeywords) {
  assert(
    semParserSrc.includes(kw),
    `semanticParser.js contains keyword "${kw}" in TEXT_TO_SQL rules`
  );
}

// =====================================================
// PHASE 2: Dynamic Routing Tests
// =====================================================
console.log('\n📋 PHASE 2: Routing Validation (Dynamic Testing)\n');

const BASE = 'http://localhost:5199/api/chat';
const tests = [
  { name: 'SQL Analytics (IT)', query: 'สรุปอุปกรณ์ IT ของฝ่าย Marketing มีอะไรบ้างและเป็นเงินเท่าไหร่', expectSql: true },
  { name: 'SQL Analytics (HR)', query: 'ปีนี้ใครลาป่วยเยอะที่สุด', expectSql: true },
  { name: 'Exact Employee', query: 'EMP001 มีใบเตือนไหม', expectSql: false, expectSource: 'gemini' },
  { name: 'Vector Search', query: 'นโยบายทำงานที่บ้าน', expectSql: false, expectSource: 'gemini' },
];

async function runDynamicTests() {
  for (const test of tests) {
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: test.query, viewer: { role: 'CEO', employeeId: 1 } }),
      });
      const data = await res.json();

      console.log(`\n  🔹 Test: ${test.name}`);
      console.log(`     Query: "${test.query}"`);
      console.log(`     sqlUsed: ${data.sqlUsed}, answerSource: ${data.answerSource}`);

      assert(
        data.sqlUsed === test.expectSql,
        `sqlUsed === ${test.expectSql}`
      );

      if (test.expectSource !== undefined) {
        assert(
          data.answerSource === test.expectSource || data.answerSource === 'sql-analytics',
          `answerSource matches expected (got: ${data.answerSource})`
        );
      }
    } catch (e) {
      console.log(`  ❌ ERROR: ${e.message}`);
      failed++;
    }
  }
}

// =====================================================
// Run and report
// =====================================================
await runDynamicTests();

console.log(`\n${'='.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 All E2E tests passed!\n');
}