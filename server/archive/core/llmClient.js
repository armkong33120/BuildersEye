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

// ── API Cost tracking (เก็บ tokens จริงจาก response.usage) ──
// ราคา USD / 1M tokens (deepseek-v4-flash) — ปรับได้ผ่าน env (LLM_PRICE_INPUT/OUTPUT/CACHE)
const PRICE_INPUT = Number(process.env.LLM_PRICE_INPUT || 0.14);
const PRICE_CACHE_INPUT = Number(process.env.LLM_PRICE_CACHE_INPUT || 0.0028);
const PRICE_OUTPUT = Number(process.env.LLM_PRICE_OUTPUT || 0.28);
const usageStats = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  byModel: {},
  _lock: Promise.resolve(),
};
function trackUsage(usage, model) {
  if (!usage) return;
  const pt = Number(usage.prompt_tokens || 0);
  const ct = Number(usage.completion_tokens || 0);
  const crt = Number(usage.prompt_tokens_details?.cached_tokens || 0);
  const cost = (pt * PRICE_INPUT + crt * PRICE_CACHE_INPUT + ct * PRICE_OUTPUT) / 1_000_000;
  usageStats.calls += 1;
  usageStats.promptTokens += pt;
  usageStats.completionTokens += ct;
  usageStats.cacheReadTokens += crt;
  usageStats.costUsd += cost;
  usageStats.byModel[model] = usageStats.byModel[model] || { calls: 0, prompt: 0, completion: 0 };
  const m = usageStats.byModel[model];
  m.calls += 1; m.prompt += pt; m.completion += ct;
  console.log(`[llm-cost] model=${model} in=${pt} out=${ct} cache=${crt} call≈$${cost.toFixed(5)} (รวม≈$${usageStats.costUsd.toFixed(4)})`);
}
export function getUsageStats() {
  return {
    calls: usageStats.calls,
    promptTokens: usageStats.promptTokens,
    completionTokens: usageStats.completionTokens,
    cacheReadTokens: usageStats.cacheReadTokens,
    estimatedCostUsd: Number(usageStats.costUsd.toFixed(6)),
    byModel: usageStats.byModel,
  };
}

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

  // ประหยัด token: คอนฟิกผ่าน env (default เปลี่ยนจากค่าปกติ DeepSeek = thinking high)
  //   LLM_THINKING=disabled  → ปิด chain-of-thought (งานสรุป/retrieval ไม่ต้องใช้)
  //   LLM_REASONING_EFFORT=low → ลด reasoning tokens (0-99%)
  const thinkingDisabled = process.env.LLM_THINKING === 'disabled';
  const reasoningEffort = process.env.LLM_REASONING_EFFORT; // undefined = ค่า default ของ model

  try {
    const openai = getClient();
    if (!openai) return null;

    const completionArgs = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // rawSql ต้องมีที่ว่างพอ (SQL ซับซ้อน + v4-flash เผา token กับ reasoning) — 1200 ไม่ใช่ 600
      max_tokens: options.rawSql ? 1200 : 500,
      temperature: options.rawSql ? 0.0 : 0.3,
    };
    // IMPORTANT: DeepSeek รับ `thinking` เป็น TOP-LEVEL param (ไม่ใช่ extra_body) —
    // extra_body ถูก ignore → reasoning ยังกิน token จน content ว่าง (finish=length)
    if (thinkingDisabled) completionArgs.thinking = { type: 'disabled' };
    else if (reasoningEffort) completionArgs.reasoning_effort = reasoningEffort;

    const response = await openai.chat.completions.create(completionArgs);

    trackUsage(response?.usage, model);
    return response.choices?.[0]?.message?.content || null;
  } catch (e) {
    // SECURITY FIX R4-2: log only a safe, truncated error (no full message that
    // could contain URLs/keys/stack internals).
    console.error('[llm] LLM API error:', String(e?.message || 'unknown').slice(0, 200));
    return null;
  }
}
