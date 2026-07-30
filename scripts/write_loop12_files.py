#!/usr/bin/env python3
"""Write semanticParser.js + update searchIndex.js + chatController.js for LOOP 12"""
import os

BASE = "/Users/arm/AI Test/mail-onedrive-org-graph/server"

# ── 1. Write semanticParser.js ──
semantic_content = """import { isLLMAvailable } from './llmClient.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function parseIntentSemantically(query, viewerContext, flatIndex) {
  if (!isLLMAvailable()) return null;

  const viewerId = viewerContext?.employeeId || 1;
  const viewerRole = viewerContext?.role || 'CEO';

  // Determine viewer's department
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

  const systemPrompt = `You are the Semantic Query Parser for BuildersEye. Your job is to translate a user's natural language query (which may contain Thai/English typos, synonyms, or relative terms) into a structured search intent JSON object.

Available Database Sheets & Fields:
- Employee_Profile (fields: name, department, jobTitle)
- KPI_OKR_History (fields: kpiScore, okrScore, performanceBand)
- Warning_Disciplinary_History (fields: severity, formalWarning)
- Learning_Development (fields: trainingName, completionStatus)
- Project_History (fields: projectId, role, contributionSummary)

Valid Departments:
${deptNames.join(', ')}

Viewer Context:
- Viewer ID: ${viewerId}
- Viewer Role: ${viewerRole}
- Viewer Department: ${viewerDept}

Mapping Rules:
1. Resolve relative terms: If query says "my team", "my colleagues", "เพื่อนร่วมงานของฉัน", "คนในทีม", check the Viewer Department. If it is known (not "Unknown"), automatically add a department filter: { "field": "department", "operator": "eq", "value": "${viewerDept}" }.
2. Correct common Thai typos/synonyms:
   - "เพื่อรวมงาน" / "เพือนร่วมงาน" -> colleagues
   - "เคพีไอ" / "เคพีไอส์" / "เคพีไอต่ำ" -> KPI
   - "โปรเจค" / "โปรเจ็ค" -> Project
   - "วอนิ่ง" / "วอร์นนิ่ง" / "เตือน" -> warning
   - "เทรนนิ่ง" / "เทรนนิง" / "อบรม" -> training
3. Detect Analytics Intents:
   - "min" / "lowest" / "ต่ำสุด" / "น้อยสุด" -> ANALYTICS_MIN
   - "max" / "highest" / "สูงสุด" / "มากสุด" -> ANALYTICS_MAX
   - If analytics intent is detected, set the field to "kpiScore" or "okrScore".
4. Detect EXACT_EMPLOYEE: If query mentions a specific employee ID like EMP045 or "employee 45", extract the pk.

Return ONLY a valid JSON object (no markdown, no explanation). Structure:
{
  "intents": [
    { "type": "ANALYTICS_MIN"|"ANALYTICS_MAX"|"EXACT_EMPLOYEE", "field": "kpiScore"|"okrScore", "pk": number }
  ],
  "filters": [
    { "field": "department"|"severity"|"performanceBand"|"completionStatus", "operator": "eq"|"contains"|"in", "value": string|array, "sheet": string }
  ],
  "sortField": null|string,
  "sortDir": null|"asc"|"desc",
  "confidence": 0.0-1.0
}`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });
    const result = await model.generateContent(systemPrompt + "\\n\\nUser Query: " + query);
    const text = result.response.text();

    // Extract JSON from response
    const jsonMatch = text.match(/\\{[\\s\\S]*\\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      parsed.confidence = parsed.confidence || 0.8;

      // Apply viewer context resolution inline
      if (viewerDept !== 'Unknown') {
        const hasRelativeTerm = /my team|my colleagues|เพื่อนร่วมงาน|ในทีม|คนในทีม|ของฉัน|ของผม/i.test(query);
        if (hasRelativeTerm) {
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
"""
with open(os.path.join(BASE, "semanticParser.js"), "w") as f:
    f.write(semantic_content)
print("Wrote semanticParser.js")

# ── 2. Update searchIndex.js: accept parsedIntent ──
srch = open(os.path.join(BASE, "searchIndex.js"), "r").read()

# Change function signature
srch = srch.replace(
    "export function search(query, { flatIndex, searchIndex }) {",
    "export function search(query, { flatIndex, searchIndex }, parsedIntent = null) {"
)

# Change parsed intent logic
srch = srch.replace(
    "  const parsed = parseIntent(query);",
    "  const parsed = parsedIntent || parseIntent(query);"
)

open(os.path.join(BASE, "searchIndex.js"), "w").write(srch)
print("Updated searchIndex.js")

# ── 3. Update chatController.js: call semanticParser ──
cc = open(os.path.join(BASE, "chatController.js"), "r").read()

# Add import
cc = cc.replace(
    "import { anonymize, deAnonymize, buildContext } from './anonymizer.js';",
    "import { anonymize, deAnonymize, buildContext } from './anonymizer.js';\nimport { parseIntentSemantically } from './semanticParser.js';\nimport { parseIntent } from './intentParser.js';"
)

# Add semantic parsing before search call
cc = cc.replace(
    '  const sr = search(query, { flatIndex, searchIndex });',
    """  // Semantic parsing (LOOP 12)
  let parsedIntent = null;
  try {
    parsedIntent = await parseIntentSemantically(query, { role: viewerRole, employeeId: viewerPk }, flatIndex);
  } catch (e) {}
  const sr = search(query, { flatIndex, searchIndex }, parsedIntent);"""
)

# Add _parsedIntent to response
cc = cc.replace(
    "    llmUsed: llmUsed,",
    "    _parsedIntent: parsedIntent || parseIntent(query),\n    llmUsed: llmUsed,"
)

open(os.path.join(BASE, "chatController.js"), "w").write(cc)
print("Updated chatController.js")

print("\nAll LOOP 12 files written successfully.")