import 'dotenv/config';
import OpenAI from 'openai';

let client = null;

export function getClient() {
  if (!client && process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here') {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export function isLLMAvailable() {
  const skip = process.env.LLM_SKIP === 'true';
  const hasKey = Boolean(process.env.OPENAI_API_KEY) && process.env.OPENAI_API_KEY !== 'your_api_key_here';
  return !skip && hasKey;
}

export async function generateAnswer(query, anonymizedContext, options = {}) {
  if (!isLLMAvailable()) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const systemPrompt = [
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
      max_tokens: 500,
      temperature: 0.3,
    });

    return response.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('[llm] OpenAI API error:', e.message);
    return null;
  }
}
