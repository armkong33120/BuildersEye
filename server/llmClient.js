import 'dotenv/config';
import OpenAI from 'openai';

// LLM provider config — supports DeepSeek (default) or any OpenAI-compatible endpoint.
//   LLM_BASE_URL   (default https://api.deepseek.com for DeepSeek)
//   LLM_API_KEY    (default: DEEPSEEK_API_KEY, then OPENAI_API_KEY)
//   LLM_MODEL      (default: deepseek-chat)
//   OPENAI_API_KEY / OPENAI_MODEL  (kept for backward compat)
const BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const MODEL = process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'deepseek-chat';

let client = null;

export function getClient() {
  if (!client && API_KEY && API_KEY !== 'your_api_key_here') {
    client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
  }
  return client;
}

export function isLLMAvailable() {
  const skip = process.env.LLM_SKIP === 'true';
  const hasKey = Boolean(API_KEY) && API_KEY !== 'your_api_key_here';
  return !skip && hasKey;
}

export async function generateAnswer(query, anonymizedContext, options = {}) {
  if (!isLLMAvailable()) return null;

  const model = MODEL;

  // Two modes:
  //  - default (chat assistant): answer a question given context
  //  - options.rawSql: return ONLY raw SQL (no chat system prompt, no Thai-instruction)
  const systemPrompt = options.rawSql
    ? "You are a SQL generation engine. Output ONLY the requested SQL query. No markdown, no explanation, no ``` code fences, no Thai text. Return the raw SQL only."
    : [
        "You are BuildersEye HR Analytics Assistant. Answer based ONLY on provided context.",
        "Rules:",
        "1. Answer in the same language as the question (Thai if asked in Thai)",
        "2. Be specific — cite exact values (KPI scores, severity levels, performance bands)",
        "3. Keep answers concise (2-4 sentences) and conversational",
        "4. Do not make up information not in the context",
        "5. Refer to employees by their labels (Employee_A, Employee_B, etc.)",
        "6. If the query asks for a COUNT ('How many', 'กี่คน', 'มีกี่'), respond with the exact number and a brief summary (e.g., 'มีทั้งหมด 10 คนครับ โดย...')",
        "7. If the context is an analytics summary (maximum/minimum KPI), rephrase it into a natural sentence (e.g., 'คนที่ได้ KPI สูงสุดคือ...')",
        "8. Never dump raw data — always write like a helpful human assistant",
      ].join("\n");

  const userPrompt = "Context:\n" + anonymizedContext + "\n\nQuestion: " + query;

  try {
    const openai = getClient();
    if (!openai) return null;

    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: options.rawSql ? 800 : 500,
      temperature: options.rawSql ? 0.0 : 0.3,
    });

    return response.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('[llm] LLM API error:', e.message);
    return null;
  }
}
