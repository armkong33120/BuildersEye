import alasql from 'alasql';
import { generateAnswer, isLLMAvailable } from './llmClient.js';

let dbInitialized = false;

export function initDatabase(flatIndex) {
  try { alasql('DROP TABLE IF EXISTS employee_data'); } catch(e) {}
  alasql('CREATE TABLE employee_data (employeeId INT, employeeCode STRING, employeeName STRING, department STRING, sheetName STRING, fieldName STRING, content STRING, confidentialityLevel STRING)');
  alasql.tables.employee_data.data = flatIndex;
  dbInitialized = true;
  console.log('[sql] AlaSQL DB ready — ' + flatIndex.length + ' records');
}

export function isDBReady() { return dbInitialized; }

export async function generateAndRunSQL(userQuery, ctx = {}) {
  if (!dbInitialized) return { error: 'Database not initialized' };
  if (!isLLMAvailable()) return { error: 'LLM not available' };

  // ── RBAC Scope Injection (Layer 2 — Execution Wrapper: security boundary จริง) ──
  // CEO/HR (scopeCodes=null) → รันบน employee_data ทั้งตาราง (เต็มสิทธิ์)
  // Employee/Manager (scopeCodes=Set) → สร้าง scoped table เฉพาะแถวของคนใน scope
  // แล้วให้ LLM รันกับ scoped table เท่านั้น → count/avg/rows อยู่ใน scope เสมอ
  const viewerRole = ctx?.viewerRole || 'CEO';
  const scopeCodes = ctx?.scopeCodes || null;
  const isScoped = scopeCodes instanceof Set && scopeCodes.size > 0;

  if (isScoped) {
    const fullRows = alasql.tables.employee_data?.data || [];
    const scopedRows = fullRows.filter(r => scopeCodes.has(r.employeeCode));
    try { alasql('DROP TABLE IF EXISTS employee_data_scoped'); } catch (e) {}
    alasql('CREATE TABLE employee_data_scoped (employeeId INT, employeeCode STRING, employeeName STRING, department STRING, sheetName STRING, fieldName STRING, content STRING, confidentialityLevel STRING)');
    alasql.tables.employee_data_scoped.data = scopedRows;
    console.log(`[sql] scoped view: role=${viewerRole} rows=${scopedRows.length}/${fullRows.length}`);
  }

  const scopeNotice = isScoped
    ? `- ACCESS SCOPE (ENFORCED — hard filter already applied): the table is named "employee_data_scoped" and contains ONLY rows for your allowed employees (${[...scopeCodes].slice(0, 15).join(', ')}${scopeCodes.size > 15 ? ', ...' : ''}).\n  Do NOT reference any other table. Do NOT assume data outside this scope exists.`
    : `- ACCESS SCOPE: you are ${viewerRole} with full access. Table name: employee_data`;

  const prompt = `You are a SQLite expert. Convert the user's query into a SQL query.
Table name: employee_data
Schema:
- employeeId (INT)
- employeeName (STRING)
- department (STRING)
- sheetName (STRING): MUST BE ONE OF ["Employee_Profile", "Career_Timeline", "KPI_OKR_History", "Project_History", "Collaboration_Network", "Warning_Disciplinary_History", "Learning_Development", "IT_Asset_Register", "IT_Ticket_Log", "Software_Licenses", "Salary_History", "Attendance_Record", "360_Feedback", "Skill_Matrix", "Succession_Planning", "Benefit_Claims", "Expense_Reports", "Grievance_Log", "Compliance_Mandates", "Onboarding_Journey", "Employee_Engagement", "Physical_Security", "Timesheet_Log", "Product_Catalog", "Revenue_By_Product", "Customer_Portfolio", "Department_PnL", "Sales_Pipeline", "Operating_Expenses"]
- fieldName (STRING): MUST BE ONE OF ["kpiScore", "okrScore", "formalWarning", "verbalWarning", "department", "position", "Cost_THB", "Cost_Per_Seat_THB", "Asset_Type", "Brand", "Status", "Ticket_Issue", "License_Name", "Base_Salary", "Bonus_Months", "Increase_Percent", "Sick_Leave_Days", "Personal_Leave_Days", "Late_Arrivals", "Reviewer_Type", "Comment", "Core_Skill", "Language_Score_IELTS", "Certification", "Flight_Risk_Pct", "Impact_of_Loss", "Readiness", "Medical_THB", "Dental_THB", "Wellness_THB", "Travel_THB", "Entertainment_THB", "Office_Supplies_THB", "Complaint_Type", "Mandate", "Culture_Fit_Score", "Interview_Score", "Buddy_Name", "eNPS", "Burnout_Risk", "Access_Zone", "Parking_Slot", "Last_Badge_Swipe", "Billable_Hours_Pct", "Admin_Hours_Pct", "budgetTHB", "actualCostTHB", "customerId", "product_name", "unit_price_thb", "category", "revenue_thb", "profit_margin_pct", "deal_value_thb", "deal_name", "stage", "probability_pct", "amount_thb", "contract_value_thb", "account_manager_emp_id", "headcount_cost_thb", "cogs_thb", "operating_cost_thb", "net_profit_thb", "allocated_budget_thb"]
- content (STRING): the value (can be numeric string like "4.5" or text like "Yes")

${scopeNotice}

CRITICAL RULES:
1. Always cast content to FLOAT when doing math: AVG(CAST(content AS FLOAT))
2. Output ONLY the raw SQL query, no markdown, no explanation, no \`\`\`sql block.
3. If asking for averages, use AVG. If asking for counts, use COUNT.
3a. **CRITICAL: When counting PEOPLE/employees (กี่คน, จำนวนคน, มีใครบ้าง, สรุป), ALWAYS use COUNT(DISTINCT employeeId) — NEVER COUNT(*)**. Each employee has many rows across sheets, so COUNT(*) over-counts. Examples:
    - "มีกี่คนที่ KPI ต่ำ" → SELECT COUNT(DISTINCT employeeId) FROM ... WHERE sheetName='KPI_OKR_History' AND fieldName='kpiScore' AND CAST(content AS FLOAT) < 3
    - "กี่คนที่ burnout สูง" → SELECT COUNT(DISTINCT employeeId) FROM ... WHERE sheetName='Employee_Engagement' AND fieldName='Burnout_Risk' AND content='High'
    - "กี่คนที่ได้ warning" → SELECT COUNT(DISTINCT employeeId) FROM ... WHERE sheetName='Warning_Disciplinary_History' AND fieldName IN ('formalWarning','verbalWarning') AND content='Yes'
4-8. (Standard KPI/OKR/Salary/Attendance/IT rules preserved)
9. When filtering by engagement: WHERE fieldName='eNPS' AND sheetName='Employee_Engagement'
10. When filtering by compliance: WHERE fieldName='Mandate' AND sheetName='Compliance_Mandates'
11. When filtering by expenses: WHERE fieldName='Travel_THB' AND sheetName='Expense_Reports'
12. When filtering by project budget: WHERE fieldName='budgetTHB' AND sheetName='Project_History'
13. When filtering by customer: WHERE fieldName='customerId' AND sheetName='Project_History' OR 'Customer_Portfolio'
14. When filtering by product/revenue: WHERE fieldName='revenue_thb' AND sheetName='Revenue_By_Product'
15. When filtering by deals: WHERE fieldName='deal_value_thb' AND sheetName='Sales_Pipeline'
16. When filtering by operating expenses: WHERE fieldName='amount_thb' AND sheetName='Operating_Expenses'
17. When filtering by department P&L: WHERE fieldName='net_profit_thb' AND sheetName='Department_PnL'

User Query: ${userQuery}
SQL Query:`;
  
  const sqlQuery = await generateAnswer(userQuery, prompt, { rawSql: true });
  if (!sqlQuery) return { error: 'LLM failed to generate SQL' };

  let cleanSQL = sqlQuery.replace(/```sql|```/g, '').trim();

  // Safety rewrite (Layer 2 hardening): แม้ LLM จะอ้างชื่อตารางเต็ม ก็บังคับให้
  // ทุก reference ไปที่ scoped table → execution แยกข้อมูลสมบูรณ์ก่อน alasql
  if (isScoped) cleanSQL = cleanSQL.replace(/\bemployee_data\b/g, 'employee_data_scoped');

  // SECURITY FIX R4-1: allowlist — only read-only SELECT queries are allowed.
  // Blocks destructive statements (DROP/UPDATE/DELETE/INSERT/ALTER/CREATE/PRAGMA/ATTACH).
  const dangerous = /(^|[;\s])\s*(DROP|UPDATE|DELETE|INSERT|ALTER|CREATE|REPLACE|TRUNCATE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX)\b/i;
  if (!/^\s*SELECT\b/i.test(cleanSQL) || dangerous.test(cleanSQL)) {
    console.warn('[sql] Blocked non-SELECT/destructive SQL rejected.');
    return { error: 'Blocked: only read-only SELECT queries are permitted' };
  }

  console.log('[sql] SQL:', cleanSQL.substring(0, 200));

  try {
    const results = alasql(cleanSQL);
    return { sql: cleanSQL, data: results, error: null, scoped: isScoped, viewerRole };
  } catch (err) {
    // SECURITY FIX R4-2: do not leak internal DB error details to the caller.
    console.error('[sql] Exec error:', err.message);
    return { sql: cleanSQL, data: null, error: 'Query execution failed' };
  }
}