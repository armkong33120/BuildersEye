import { isLLMAvailable, getClient } from './llmClient.js';
import { getHistory } from './chatMemory.js';

export async function parseIntentSemantically(query, viewerContext, flatIndex, conversationId = '') {
  if (!isLLMAvailable()) return null;

  const viewerId = viewerContext?.employeeId || 1;
  const viewerRole = viewerContext?.role || 'CEO';
  
  const history = getHistory(conversationId);
  const historyStr = history.length > 0
    ? history.map(m => m.role + ': ' + m.content).join('\n')
    : '(empty)';

  let viewerDept = 'Unknown';
  const deptRec = flatIndex.find(r =>
    r.employeeId === viewerId &&
    r.sheetName === 'Employee_Profile' &&
    r.fieldName === 'department'
  );
  if (deptRec) viewerDept = deptRec.content;

  const deptNames = [
    'Customer Service & Warranty', 'Design & Architecture',
    'Engineering & Construction', 'Executive', 'Finance & Accounting',
    'HR & Admin', 'IT', 'Legal', 'Marketing', 'Office Support',
    'Procurement & Warehouse', 'Sales'
  ];

  const systemPrompt = `You are the Semantic Query Parser for BuildersEye. Translate a user's natural language query into a structured search intent JSON object.

Conversation History (for context):
${historyStr}

Available Database Sheets & Fields (29 sheets total):
- Employee_Profile (pk, name, department, jobTitle)
- Career_Timeline (date, eventType, title)
- KPI_OKR_History (kpiScore, okrScore, performanceBand)
- Project_History (projectId, role, contributionSummary, budgetTHB, actualCostTHB, customerId)
- Collaboration_Network (collaboratorName, relationshipType, collaborationQuality)
- Warning_Disciplinary_History (severity ENUM: ONLY "Low","Medium","High","Critical", formalWarning)
- Learning_Development (trainingName, completionStatus)
- IT_Asset_Register (Asset_Type, Brand, Cost_THB, Status)
- IT_Ticket_Log (Ticket_Issue, Status)
- Software_Licenses (License_Name, Cost_Per_Seat_THB, Status)
- Salary_History (Base_Salary, Bonus_Months, Increase_Percent)
- Attendance_Record (Sick_Leave_Days, Personal_Leave_Days, Late_Arrivals)
- 360_Feedback (Reviewer_Type, Comment)
- Skill_Matrix (Core_Skill, Language_Score_IELTS, Certification)
- Succession_Planning (Flight_Risk_Pct, Impact_of_Loss, Readiness)
- Benefit_Claims (Medical_THB, Dental_THB, Wellness_THB)
- Expense_Reports (Travel_THB, Entertainment_THB, Office_Supplies_THB)
- Grievance_Log (Complaint_Type, Status)
- Compliance_Mandates (Mandate, Status — values: "Passed","Pending")
- Onboarding_Journey (Culture_Fit_Score, Interview_Score, Buddy_Name)
- Employee_Engagement (eNPS 1-10, Burnout_Risk — values: "Low","Medium","High")
- Physical_Security (Access_Zone, Parking_Slot, Last_Badge_Swipe)
- Timesheet_Log (Billable_Hours_Pct, Admin_Hours_Pct)
- Product_Catalog (product_id, product_name, category, unit_price_thb, owner_department)
- Revenue_By_Product (product_id, quarter, units_sold, revenue_thb, cost_thb, profit_margin_pct)
- Customer_Portfolio (customer_id, customer_name, industry, contract_value_thb, account_manager_emp_id)
- Department_PnL (department, year, revenue_thb, cogs_thb, headcount_cost_thb, net_profit_thb, profit_margin_pct)
- Sales_Pipeline (deal_id, deal_name, customer_id, deal_value_thb, stage, probability_pct)
- Operating_Expenses (month, category, department, amount_thb, vendor, payment_status)

Valid Departments: ${deptNames.join(', ')}

Viewer Context:
- Viewer ID: ${viewerId}, Role: ${viewerRole}, Department: ${viewerDept}

JSON Schema:
{
  "intents": [{ "type": "ANALYTICS_MIN"|"ANALYTICS_MAX"|"EXACT_EMPLOYEE"|"TEXT_TO_SQL"|"VECTOR_SEARCH", "field": "kpiScore"|"okrScore", "metric": "min"|"max", "pk": number }],
  "filters": [{ "field": "department"|"severity"|"performanceBand"|"completionStatus"|"Burnout_Risk"|"Mandate", "operator": "eq"|"contains"|"in", "value": "string"|["array"], "sheet": "string" }],
  "sortField": null|"kpiScore"|"okrScore"|"eNPS"|"Flight_Risk_Pct"|"revenue_thb"|"deal_value_thb",
  "sortDir": null|"asc"|"desc",
  "confidence": 0.0-1.0,
  "isCount": false,
  "isClarification": false,
  "clarificationMessage": "",
  "suggestedOptions": []
}

DYNAMIC CLARIFICATION & SUGGESTION LOGIC:
When the query is ambiguous or you want to suggest high-probability follow-ups, generate exactly 3 "suggestedOptions" that are context-aware:
1. Analyze the viewer.role (${viewerRole}) and viewer.department (${viewerDept}).
2. Look at the database sheets that are most relevant to this role.
3. Generate 3 clickable options that carry the highest probability of what the user intended.
   Examples:
   - Query: "งบเยอะสุด" | Viewer: CEO → Options: "งบรวมทั้งองค์กร?", "แผนกไหนค่าใช้จ่ายสูงสุด?", "โปรเจกต์ที่ใช้ทรัพยากรมากสุด?"
   - Query: "งบเยอะสุด" | Viewer: IT Manager → Options: "โปรเจกต์ IT ใช้งบสูงสุด?", "ค่าซอฟต์แวร์แพงสุด?", "ใครเบิกอุปกรณ์ IT มากสุด?"
   - Query: "ใครเก่ง" | Viewer: HR → Options: "KPI สูงสุดทั้งบริษัท?", "ใครมีผลงานดีเด่น?", "คะแนน OKR สูงสุด?"
   - Query: "ทีมไหนมีปัญหา" | Viewer: CEO → Options: "แผนกใบเตือนเยอะสุด?", "แผนก Burnout สูงสุด?", "แผนกที่มีคนลาออกเสี่ยงสูง?"
4. Keep options SHORT (<10 words), punchy, and in the user's language (Thai).
5. If the query is clear and requires no suggestions, return an empty array [].

CRITICAL RULES:
1. severity field ONLY accepts: "Low", "Medium", "High", "Critical". 
2. performanceBand values: "Exceptional (A)", "Exceeds (B)", "Meets (C)", "Below (D)", "Unsatisfactory (E)". 
3. completionStatus values: "Complete", "Incomplete". Burnout_Risk values: "Low", "Medium", "High". Mandate values: "Passed", "Pending".
4. VIEWER CONTEXT: Only add viewer's department filter if query explicitly says "ทีมฉัน", "ของฉัน", "ลูกทีม".
5. ANALYTICS DETECTION (IMPORTANT):
   - "ใครเก่งสุด"/"highest KPI" -> ANALYTICS_MAX, field=kpiScore
   - "ใครแย่สุด"/"lowest KPI" -> ANALYTICS_MIN, field=kpiScore
   - "ใบเตือนเยอะสุด"/"most warnings" -> ANALYTICS_MAX, field=formalWarning
   - COMPLEX ANALYTICS / COUNTS: "ค่าเฉลี่ย" (average), "เปรียบเทียบ" (compare), "กี่คน", "มีกี่", "กี่เครื่อง" (how many/count) -> TEXT_TO_SQL
   - HR/IT DATA QUERIES: "เงินเดือน" (salary), "โบนัส" (bonus), "ขึ้นเงินเดือน" (raise), "ลาป่วย" (sick leave), "ลากิจ" (personal leave), "มาสาย" (late), "notebook", "คอม" (computer), "มือถือ" (mobile), "iPad", "license", "ซอฟต์แวร์" -> TEXT_TO_SQL
   - LOOP 22 HCM QUERIES: "เบิกเงิน" (expense claim), "ค่าเดินทาง" (travel cost), "Burnout" (burnout risk), "ลาออก" (flight risk/resign), "ทักษะ" (skill), "ภาษา" (language/IETLS), "ร้องเรียน" (complaint/grievance), "เข้าตึก" (badge/access), "ใบเซอร์" (certification), "คอมไพล์เอินซ์" (compliance), "PDPA", "eNPS", "ผลสำรวจ" (survey/engagement), "สัมภาษณ์" (interview), "ที่จอดรถ" (parking) -> TEXT_TO_SQL
   - LOOP 24 BUSINESS QUERIES: "สินค้า" (product), "บริการ" (service), "รายได้" (revenue), "กำไร" (profit), "ลูกค้า" (customer), "สัญญา" (contract), "ดีล" (deal), "ปิดการขาย" (close), "งบประมาณ" (budget), "ต้นทุน" (cost), "มาร์จิ้น" (margin), "ยอดขาย" (sales), "pipeline", "ค่า license", "ค่าซอฟต์แวร์", "ค่าเช่า" (rent), "ค่าไฟ" (electricity), "ค่าน้ำ", "ค่าน้ำมัน" (fuel), "ค่ายิง Ad", "ค่าโฆษณา", "ค่าประกัน" (insurance), "ค่าอินเทอร์เน็ต", "ค่าทำความสะอาด", "รปภ", "ค่าขนส่ง", "ค่าบำรุงรักษา", "revenue", "profit", "customer", "deal", "margin", "product", "contract", "P&L", "budget", "rent", "utilities", "electricity", "fuel", "advertising", "insurance", "operating expenses" -> TEXT_TO_SQL
   - VECTOR SEARCH: If query asks for general knowledge (นโยบาย, โปรเจกต์, สรุปผลงาน, เป้าหมาย) and NOT a specific employee name, return intent type: "VECTOR_SEARCH" (confidence=0.8)
6. CLARIFICATION: ONLY set isClarification=true when the query is completely meaningless. Salary/attendance/IT/HCM/Business queries are valid TEXT_TO_SQL — do NOT clarify them. When you DO set isClarification, also populate suggestedOptions with 3 helpful rephrasing suggestions.
7. CONTEXT FOLLOW-UP: If query has pronouns ("เขา", "ไอ้นี่", "คนนั้น"), it is a FOLLOW-UP.
8. NO FALSE CLARIFICATIONS: Short follow-up queries with pronouns are valid.
9. Return ONLY valid JSON, no markdown, no explanation. Always include "suggestedOptions" in the output (can be empty array if no suggestions needed).`;

  try {
    const openai = getClient();
    if (!openai) return null;

    const response = await openai.chat.completions.create({
      model: process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: "User Query: " + query }
      ],
      temperature: 0.0,
      response_format: { type: "json_object" }
    });

    const text = response.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      parsed.confidence = parsed.confidence || 0.8;
      parsed.suggestedOptions = parsed.suggestedOptions || [];

      if (viewerDept !== 'Unknown') {
        const hasPossessiveTerm = /ลูกทีม|ทีมฉัน|ทีมงาน|ของฉัน|ของผม|my team|my colleagues|ของเรา/i.test(query);
        if (hasPossessiveTerm) {
          const hasDeptFilter = (parsed.filters || []).some(f => f.field === 'department');
          if (!hasDeptFilter) {
            parsed.filters = parsed.filters || [];
            parsed.filters.push({ field: 'department', operator: 'eq', value: viewerDept });
          }
        }
      }
      return parsed;
    }
    console.warn('[semanticParser] No JSON found in LLM response');
    return null;
  } catch (e) {
    console.error('[semanticParser] Error:', e.message);
    return null;
  }
}