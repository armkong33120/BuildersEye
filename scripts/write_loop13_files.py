#!/usr/bin/env python3
"""Write/update all files for LOOP 13: Conversational RAG"""
import os

BASE = "/Users/arm/AI Test/mail-onedrive-org-graph/server"
SRC = "/Users/arm/AI Test/mail-onedrive-org-graph/src"

# ── 1. Write chatMemory.js ──
chatMemory = """// In-memory conversation store
const sessions = new Map();
const MAX_HISTORY = 6;

export function getHistory(conversationId) {
  if (!conversationId) return [];
  return sessions.get(conversationId) || [];
}

export function addMessage(conversationId, role, content) {
  if (!conversationId) return;
  if (!sessions.has(conversationId)) sessions.set(conversationId, []);
  const history = sessions.get(conversationId);
  history.push({ role, content });
  // Keep only last MAX_HISTORY messages
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

export function clearHistory(conversationId) {
  if (!conversationId) return;
  sessions.delete(conversationId);
}
"""
with open(os.path.join(BASE, "chatMemory.js"), "w") as f:
    f.write(chatMemory)
print("Wrote chatMemory.js")

# ── 2. Update semanticParser.js ──
sp_path = os.path.join(BASE, "semanticParser.js")
sp = open(sp_path, "r").read()

# Add import for chatMemory
sp = sp.replace(
    "import { isLLMAvailable } from './llmClient.js';",
    "import { isLLMAvailable } from './llmClient.js';\nimport { getHistory } from './chatMemory.js';"
)

# Update function signature
sp = sp.replace(
    "export async function parseIntentSemantically(query, viewerContext, flatIndex) {",
    "export async function parseIntentSemantically(query, viewerContext, flatIndex, conversationId = '') {"
)

# Inject history before dept lookup
sp = sp.replace(
    "  const viewerId = viewerContext?.employeeId || 1;",
    """  const viewerId = viewerContext?.employeeId || 1;
  const viewerRole = viewerContext?.role || 'CEO';
  
  // Retrieve conversation history
  const history = getHistory(conversationId);
  const historyStr = history.length > 0
    ? history.map(m => m.role + ': ' + m.content).join('\\n')
    : '(empty)';"""
)

# Fix the second viewerRole decl (duplicate from old code)
sp = sp.replace(
    "  const viewerRole = viewerContext?.role || 'CEO';\n\n  // Determine viewer's department",
    "\n  // Determine viewer's department"
)

# Replace the system prompt with a stronger one
old_prompt = """  const systemPrompt = `You are the Semantic Query Parser for BuildersEye. Your job is to translate a user's natural language query (which may contain Thai/English typos, synonyms, or relative terms) into a structured search intent JSON object.

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
}`;"""

new_prompt = """  const historyStr = history.length > 0
    ? history.map(m => m.role + ': ' + m.content).join('\\n')
    : '(empty)';

  const systemPrompt = `You are the Semantic Query Parser for BuildersEye. Translate a user's natural language query into a structured search intent JSON object.

Conversation History (for context):
${historyStr}

Available Database Sheets & Fields:
- Employee_Profile (pk, name, department, jobTitle)
- KPI_OKR_History (kpiScore, okrScore, performanceBand)
- Warning_Disciplinary_History (severity ENUM: ONLY "Low","Medium","High","Critical", formalWarning)
- Learning_Development (trainingName, completionStatus)
- Project_History (projectId, role, contributionSummary)

Valid Departments: ${', '.join(deptNames)}

Viewer Context:
- Viewer ID: ${viewerId}, Role: ${viewerRole}, Department: ${viewerDept}

JSON Schema:
{
  "intents": [{ "type": "ANALYTICS_MIN"|"ANALYTICS_MAX"|"EXACT_EMPLOYEE", "field": "kpiScore"|"okrScore", "metric": "min"|"max", "pk": number }],
  "filters": [{ "field": "department"|"severity"|"performanceBand"|"completionStatus", "operator": "eq"|"contains"|"in", "value": "string"|["array"], "sheet": "string" }],
  "sortField": null|"kpiScore"|"okrScore",
  "sortDir": null|"asc"|"desc",
  "confidence": 0.0-1.0,
  "isCount": false,
  "isClarification": false,
  "clarificationMessage": ""
}

CRITICAL RULES:
1. severity field ONLY accepts these exact values: "Low", "Medium", "High", "Critical".
2. VIEWER CONTEXT: Only add department filter if query EXPLICITLY says "ลูกทีม", "ทีมฉัน", "ทีมงาน", "ของฉัน", "ของผม", "my team", "my colleagues". Do NOT add department filter for words like "ในทีม", "คนในทีม" unless explicitly possessive.
3. COUNT QUERIES: If query asks "How many"/"กี่คน"/"มีกี่", set isCount=true and use COUNT filters.
4. CLARIFICATION: If confidence < 0.6 OR query is too ambiguous, set isClarification=true and provide a Thai clarificationMessage asking the user to be more specific.
5. CONTEXT: Use the Conversation History to resolve pronouns ("เขา", "คนนี้", "that person").
6. Return ONLY valid JSON, no markdown, no explanation.`;
"""

sp = sp.replace(old_prompt, new_prompt)

# Fix viewer context resolution rules
sp = sp.replace(
    """      // Apply viewer context resolution inline
      if (viewerDept !== 'Unknown') {
        const hasRelativeTerm = /my team|my colleagues|เพื่อนร่วมงาน|ในทีม|คนในทีม|ของฉัน|ของผม/i.test(query);
        if (hasRelativeTerm) {
          const hasDeptFilter = (parsed.filters || []).some(f => f.field === 'department');
          if (!hasDeptFilter) {
            parsed.filters = parsed.filters || [];
            parsed.filters.push({ field: 'department', operator: 'eq', value: viewerDept });
          }
        }
      }""",
    """      // Apply viewer context resolution inline (only for EXPLICIT possessive terms)
      if (viewerDept !== 'Unknown') {
        const hasPossessiveTerm = /ลูกทีม|ทีมฉัน|ทีมงาน|ของฉัน|ของผม|my team|my colleagues|ของเรา/i.test(query);
        if (hasPossessiveTerm) {
          const hasDeptFilter = (parsed.filters || []).some(f => f.field === 'department');
          if (!hasDeptFilter) {
            parsed.filters = parsed.filters || [];
            parsed.filters.push({ field: 'department', operator: 'eq', value: viewerDept });
          }
        }
      }"""
)

open(sp_path, "w").write(sp)
print("Updated semanticParser.js")

# ── 3. Update chatController.js ──
cc_path = os.path.join(BASE, "chatController.js")
cc = open(cc_path, "r").read()

# Add chatMemory import
cc = cc.replace(
    "import { parseIntent } from './intentParser.js';",
    "import { parseIntent } from './intentParser.js';\nimport { addMessage, getHistory } from './chatMemory.js';"
)

# Update function signature to accept conversationId
cc = cc.replace(
    "export async function chatHandler(query, viewer, { flatIndex, searchIndex, identityGraph }) {",
    "export async function chatHandler(query, viewer, { flatIndex, searchIndex, identityGraph }, conversationId = '') {"
)

# Pass conversationId to semanticParser
cc = cc.replace(
    "parsedIntent = await parseIntentSemantically(query, { role: viewerRole, employeeId: viewerPk }, flatIndex);",
    "parsedIntent = await parseIntentSemantically(query, { role: viewerRole, employeeId: viewerPk }, flatIndex, conversationId);"
)

# Handle clarification before search
cc = cc.replace(
    "  const sr = search(query, { flatIndex, searchIndex }, parsedIntent);",
    """  // Check for clarification request
  if (parsedIntent && parsedIntent.isClarification) {
    addMessage(conversationId, 'user', query);
    addMessage(conversationId, 'assistant', parsedIntent.clarificationMessage || 'Please clarify your query.');
    return {
      query, answer: parsedIntent.clarificationMessage || 'Please clarify your query.',
      matchedEmployeePks: [], matchedDepartments: [], results: [], sources: [],
      policy: { status: 'Allowed', redactedCount: 0, blockedCount: 0 },
      scan: { employeePks: [], highlightEdges: false, sourcePk: 1, durationMs: 0 },
      scannedFileCount: 0, responseTimeMs: Date.now() - startTime,
      matchersUsed: [], _parsedIntent: parsedIntent,
      llmUsed: false, answerSource: 'clarification',
    };
  }

  const sr = search(query, { flatIndex, searchIndex }, parsedIntent);"""
)

# Fix LLM availability check - remove matchCount <= 6 restriction
cc = cc.replace(
    "  if (isLLMAvailable() && finalResults.length > 0) {",
    "  if (isLLMAvailable() && finalResults.length > 0) {  /* LLM enabled for ALL result sizes */"
)

# Add memory save at end
cc = cc.replace(
    "    answerSource: llmUsed ? 'gemini' : 'template',\n  };\n}",
    """    answerSource: llmUsed ? 'gemini' : 'template',
  };

  // Save to conversation memory
  addMessage(conversationId, 'user', query);
  addMessage(conversationId, 'assistant', result.answer);

  return result;
}"""
)

open(cc_path, "w").write(cc)
print("Updated chatController.js")

# ── 4. Update index.js to pass conversationId ──
idx_path = os.path.join(BASE, "index.js")
idx = open(idx_path, "r").read()
idx = idx.replace(
    "const { query, viewer } = req.body;",
    "const { query, viewer, conversationId } = req.body;"
)
idx = idx.replace(
    "const result = await chatHandler(query, viewer || { role: 'CEO', employeeId: 1 }, { flatIndex, searchIndex, identityGraph });",
    "const result = await chatHandler(query, viewer || { role: 'CEO', employeeId: 1 }, { flatIndex, searchIndex, identityGraph }, conversationId || '');"
)
open(idx_path, "w").write(idx)
print("Updated index.js")

# ── 5. Update llmClient.js prompt ──
llm_path = os.path.join(BASE, "llmClient.js")
llm = open(llm_path, "r").read()
old_llm_prompt = 'const prompt = "You are BuildersEye HR Analytics Assistant. Answer based ONLY on context.\\\\nRules:\\\\n1. Answer in same language as question\\\\n2. Be specific with values\\\\n3. Keep 2-4 sentences\\\\n4. Do not fabricate data\\\\n\\\\nContext:\\\\n" + anonymizedContext + "\\\\n\\\\nQuestion: " + query;'
new_llm_prompt = """const prompt = [
    "You are BuildersEye HR Analytics Assistant. Answer based ONLY on provided context.",
    "Rules:",
    "1. Answer in the same language as the question (Thai or English)",
    "2. Be specific — cite exact values (KPI scores, severity levels, performance bands)",
    "3. If the query asks for a count ('How many', 'กี่คน'), respond with the exact number and a short summary",
    "4. If the context is an analytics summary (min/max KPI), rephrase it into a natural, conversational sentence",
    "5. Keep answers concise (2-4 sentences)",
    "6. Do not make up information not in the context",
    "",
    "Context:",
    anonymizedContext,
    "",
    "Question: " + query,
  ].join("\\n");"""
llm = llm.replace(old_llm_prompt, new_llm_prompt)
open(llm_path, "w").write(llm)
print("Updated llmClient.js")

# ── 6. Update frontend: src/main.js ──
main_path = os.path.join(SRC, "main.js")
main = open(main_path, "r").read()

# Add conversationId after RAG_BACKEND
main = main.replace(
    "// RAG backend integration\nconst RAG_BACKEND = 'http://localhost:5199';",
    """// RAG backend integration
const RAG_BACKEND = 'http://localhost:5199';
var currentConversationId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);"""
)

# Update callRagBackend to send conversationId
main = main.replace(
    "body: JSON.stringify({ query: query }),",
    "body: JSON.stringify({ query: query, conversationId: currentConversationId }),"
)

# Add New Chat button in rag-chat-header (before toggleChatButton)
# Find the rag-chat-header section
header_setup = """
  // Add New Chat button
  var resetButton = document.querySelector('#resetChat');
  if (!resetButton) {
    resetButton = document.createElement('button');
    resetButton.id = 'resetChat';
    resetButton.className = 'chat-reset-button';
    resetButton.innerHTML = '<i data-lucide=\\'refresh-cw\\'></i>';
    resetButton.title = 'New Chat';
    resetButton.setAttribute('aria-label', 'New Chat');
    var chatHeader = ragChat.querySelector('.rag-chat-header');
    if (chatHeader) {
      chatHeader.appendChild(resetButton);
      createIcons({ icons });
    }
    resetButton.addEventListener('click', function() {
      chatMessages.innerHTML = '';
      currentConversationId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    });
  }"""

# Insert after the last setupIcons/createIcons call
main = main.replace(
    "setupIcons();\nbuildIndexes();\nbuildUi();\nbuildScene();\nselectPerson(graph.ceoPk, false);\nanimate();",
    "setupIcons();\nbuildIndexes();\nbuildUi();\nbuildScene();\nselectPerson(graph.ceoPk, false);\nanimate();\n" + header_setup
)

open(main_path, "w").write(main)
print("Updated src/main.js")

# ── 7. Update styles.css ──
css_path = os.path.join(SRC, "styles.css")
css = open(css_path, "r").read()
# Add reset button styles before @media block
new_css = ".chat-reset-button { width: 32px; height: 32px; border-radius: 7px; border: 1px solid var(--line); background: rgba(10, 17, 22, 0.84); color: var(--ink); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: 0 0 auto; margin-left: 6px; }\n.chat-reset-button:hover { border-color: var(--coral); color: var(--coral); }"
css = css.replace(".policy-badge.allowed", new_css + "\n\n.policy-badge.allowed")
open(css_path, "w").write(css)
print("Updated src/styles.css")

print("\nAll LOOP 13 files written/updated successfully.")