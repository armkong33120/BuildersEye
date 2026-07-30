#!/usr/bin/env python3
"""LOOP 15: Text-to-SQL + Zero Robot Language"""
import os

BASE = "/Users/arm/AI Test/mail-onedrive-org-graph/server"

# ── 1. sqlEngine.js ──
sql = """import alasql from 'alasql';
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

export async function generateAndRunSQL(userQuery) {
  if (!dbInitialized) return { error: 'Database not initialized' };
  if (!isLLMAvailable()) return { error: 'LLM not available' };

  const prompt = 'Convert to SQL:\\n' + userQuery + '\\nTable: employee_data(employeeId,employeeCode,employeeName,department,sheetName,fieldName,content)\\nRules: CAST(content AS FLOAT) for math, filter by fieldName AND sheetName, output ONLY raw SQL:';
  
  const sqlQuery = await generateAnswer(userQuery, prompt);
  if (!sqlQuery) return { error: 'LLM failed to generate SQL' };

  const cleanSQL = sqlQuery.replace(/```sql|```/g, '').trim();
  console.log('[sql] SQL:', cleanSQL.substring(0, 200));

  try {
    const results = alasql(cleanSQL);
    return { sql: cleanSQL, data: results, error: null };
  } catch (err) {
    console.error('[sql] Exec error:', err.message);
    return { sql: cleanSQL, data: null, error: err.message };
  }
}
"""
with open(os.path.join(BASE, "sqlEngine.js"), "w") as f:
    f.write(sql)
print("Wrote sqlEngine.js")

# ── 2. Update index.js ──
idx_path = os.path.join(BASE, "index.js")
idx = open(idx_path, "r").read()
idx = idx.replace(
    "import { ingestAll } from './ingestExcel.js';",
    "import { ingestAll } from './ingestExcel.js';\nimport { initDatabase } from './sqlEngine.js';"
)
idx = idx.replace(
    "indexReady = true;\n  startupTime = new Date().toISOString();",
    "initDatabase(flatIndex);\n  indexReady = true;\n  startupTime = new Date().toISOString();"
)
open(idx_path, "w").write(idx)
print("Updated index.js — initDatabase added")

# ── 3. Update chatController.js ──
cc_path = os.path.join(BASE, "chatController.js")
cc = open(cc_path, "r").read()

# Import sqlEngine
cc = cc.replace(
    "import { generateAnswer, isLLMAvailable } from './llmClient.js';",
    "import { generateAnswer, isLLMAvailable } from './llmClient.js';\nimport { generateAndRunSQL, isDBReady } from './sqlEngine.js';"
)

# Add SQL analytics check
cc = cc.replace(
    "  // Pronoun resolution (LOOP 13C — deterministic)\n  const pronounResult = resolvePronouns(query, conversationId);",
    """  // LOOP 15: SQL analytics detection
  const needsSqlAnalytics = /average|avg|เฉลี่ย|mean|group by|compare|เทียบ|เปรียบเทียบ|standard deviation/i.test(query);

  // Pronoun resolution (LOOP 13C — deterministic)\n  const pronounResult = resolvePronouns(query, conversationId);"""
)

# Add SQL path + Zero Robot Language
old_llm = """  // LLM answer generation
  let answer = sr.answer;"""
new_llm = """  // LOOP 15: SQL analytics
  let answer = sr.answer;
  let sqlUsed = false;
  if (needsSqlAnalytics && isLLMAvailable() && isDBReady()) {
    try {
      const sqlResult = await generateAndRunSQL(resolvedQuery);
      if (sqlResult.data && !sqlResult.error) {
        const sqlSummary = 'SQL Results:\\n' + JSON.stringify(sqlResult.data).substring(0, 2000);
        const fmt = await generateAnswer('Summarize in natural Thai:', sqlSummary);
        if (fmt) { answer = fmt; sqlUsed = true; }
      }
    } catch (e) { console.log('[sql] skipped'); }
  }

  // LLM answer generation (Zero Robot Language)"""
cc = cc.replace(old_llm, new_llm)

# Add sqlUsed to response
cc = cc.replace(
    "    llmUsed: llmUsed,\n    answerSource: llmUsed ? 'openai' : 'template',",
    "    llmUsed: llmUsed,\n    sqlUsed: sqlUsed,\n    answerSource: sqlUsed ? 'sql-analytics' : (llmUsed ? 'gemini' : 'template'),"
)

open(cc_path, "w").write(cc)
print("Updated chatController.js — SQL analytics + Zero Robot Language")

# ── 4. Build ──
import subprocess
r = subprocess.run(["npm", "run", "build"], cwd="/Users/arm/AI Test/mail-onedrive-org-graph", capture_output=True, text=True)
print("Build:", "OK" if "built in" in (r.stdout + r.stderr) else "FAIL")
if "built in" in (r.stdout + r.stderr):
    for line in (r.stdout + r.stderr).split("\n"):
        if "built in" in line: print(line)
print("\\nLOOP 15 complete.")