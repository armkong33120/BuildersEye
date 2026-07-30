#!/usr/bin/env python3
"""Write llmClient.js and update chatController.js + index.js for LOOP 11A"""
import os

BASE = "/Users/arm/AI Test/mail-onedrive-org-graph/server"
ROOT = "/Users/arm/AI Test/mail-onedrive-org-graph"

# ── 1. Write llmClient.js ──
with open(os.path.join(BASE, "llmClient.js"), "w") as f:
    f.write("""import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

export function isLLMAvailable() {
  const skip = process.env.LLM_SKIP === 'true';
  const hasKey = Boolean(process.env.GEMINI_API_KEY) && process.env.GEMINI_API_KEY !== 'your_api_key_here';
  return !skip && hasKey;
}

export async function generateAnswer(query, anonymizedContext, options = {}) {
  if (!isLLMAvailable()) return null;
  const prompt = [
    "You are BuildersEye HR Analytics Assistant. Answer based ONLY on provided context.",
    "Rules:",
    "1. Answer in the same language as the question",
    "2. Be specific — cite exact values (KPI scores, severity levels, performance bands)",
    "3. Keep answers concise (2-4 sentences)",
    "4. Do not make up information not in the context",
    "5. Refer to employees by their labels (Employee_A, Employee_B, etc.)",
    "",
    "Context:",
    anonymizedContext,
    "",
    "Question: " + query,
  ].join("\\n");
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (e) {
    console.error('[llm] Gemini API error:', e.message);
    return null;
  }
}
""")
print("Wrote llmClient.js")

# ── 2. Modify chatController.js ──
cc = open(os.path.join(BASE, "chatController.js"), "r").read()

# Add imports after existing imports
cc = cc.replace(
    "import { search } from './searchIndex.js';\nimport { checkQueryPolicy, resolveScope, applyFieldRedaction } from './policy.js';",
    "import 'dotenv/config';\nimport { search } from './searchIndex.js';\nimport { checkQueryPolicy, resolveScope, applyFieldRedaction } from './policy.js';\nimport { anonymize, deAnonymize, buildContext } from './anonymizer.js';\nimport { generateAnswer, isLLMAvailable } from './llmClient.js';"
)

# Make chatHandler async
cc = cc.replace("export function chatHandler(", "export async function chatHandler(")

# Add LLM layer before return
old = """  const policy = { status: redactedCount > 0 ? 'Redacted' : 'Allowed', redactedCount, blockedCount };
  const sources = sr.sources || [];

  return {
    query, answer: sr.answer,"""

new = """  const policy = { status: redactedCount > 0 ? 'Redacted' : 'Allowed', redactedCount, blockedCount };
  const sources = sr.sources || [];

  // LLM answer generation
  let answer = sr.answer;
  let llmUsed = false;
  if (isLLMAvailable() && finalResults.length > 0) {
    try {
      const { anonymizedContext, mapping, tier } = anonymize(finalResults, flatIndex);
      if (tier !== 'Tier 1 — Strict') {
        const llmAnswer = await generateAnswer(query, anonymizedContext);
        if (llmAnswer) {
          answer = deAnonymize(llmAnswer, mapping);
          llmUsed = true;
        }
      }
    } catch (e) { console.error('[llm] Error:', e.message); }
  }

  return {
    query, answer: answer,"""

cc = cc.replace(old, new)

# Add llmUsed and answerSource to response
cc = cc.replace(
    "scannedFileCount: new Set(flatIndex.map(r => r.employeeId)).size,\n    responseTimeMs: Date.now() - startTime,\n    matchersUsed: sr.matchersUsed,",
    "scannedFileCount: new Set(flatIndex.map(r => r.employeeId)).size,\n    responseTimeMs: Date.now() - startTime,\n    matchersUsed: sr.matchersUsed,\n    llmUsed: llmUsed,\n    answerSource: llmUsed ? 'gemini' : 'template',"
)

open(os.path.join(BASE, "chatController.js"), "w").write(cc)
print("Updated chatController.js")

# ── 3. Modify index.js ──
idx = open(os.path.join(BASE, "index.js"), "r").read()

# Add dotenv at top
idx = "import 'dotenv/config';\n" + idx

# Make chat route async with try/catch
idx = idx.replace(
    "app.post('/api/chat', (req, res) => {\n  const { query, viewer } = req.body;\n  if (!query) return res.status(400).json({ error: 'query is required' });\n  const result = chatHandler(query, viewer || { role: 'CEO', employeeId: 1 }, { flatIndex, searchIndex, identityGraph });\n  res.json(result);\n});",
    """app.post('/api/chat', async (req, res) => {
  try {
    const { query, viewer } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const result = await chatHandler(query, viewer || { role: 'CEO', employeeId: 1 }, { flatIndex, searchIndex, identityGraph });
    res.json(result);
  } catch (e) {
    console.error('[chat] Error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});"""
)

open(os.path.join(BASE, "index.js"), "w").write(idx)
print("Updated index.js")

# ── 4. Update .gitignore ──
gi_path = os.path.join(ROOT, ".gitignore")
gi = open(gi_path, "r").read()
if ".env" not in gi:
    gi += "\n.env\n"
    open(gi_path, "w").write(gi)
    print("Updated .gitignore (added .env)")
else:
    print(".gitignore already has .env — skipped")

print("\nAll LOOP 11A files written/updated successfully.")