// llmRerank.js — Reranking ด้วย LLM (listwise scoring) — cross-encoder สำรองที่ใช้ได้ทุกภาษา
// ตาม RAG best practice: rerank คัดซ้ำหลัง retrieve = คุ้มสุดต่อความแม่น
// ใช้ DeepSeek (ถูก) ให้คะแนนแต่ละ passage 0-10 แล้วจัดอันดับใหม่
import { getClient, isLLMAvailable } from './llmClient.js';

export async function llmRerank(query, results, { topN = 10, model } = {}) {
  if (!isLLMAvailable() || !results.length) return { reranked: false, results };
  const candidates = results.slice(0, topN);
  const openai = getClient();

  const numbered = candidates.map((r, i) => `[${i}] ${String(r.text || '').slice(0, 400)}`).join('\n');
  const prompt = `ให้คะแนนความเกี่ยวข้องของแต่ละ passage กับคำถาม 0-10 (10=ตอบคำถามโดยตรง)
คำถาม: "${query}"
passages:
${numbered}

ตอบเป็น JSON array ของตัวเลขเท่านั้น ตามลำดับ เช่น [8,2,9,...] ห้ามมีข้อความอื่น`;

  try {
    const res = await openai.chat.completions.create({
      model: model || process.env.LLM_MODEL || 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 120,
    });
    const raw = (res.choices?.[0]?.message?.content || '').trim();
    const match = raw.match(/\[[\s\S]*?\]/);
    const scores = match ? JSON.parse(match[0]) : null;
    if (!Array.isArray(scores)) return { reranked: false, results };

    const scored = candidates.map((r, i) => ({ ...r, rerankScore: Number(scores[i] ?? 0) }));
    scored.sort((a, b) => b.rerankScore - a.rerankScore);
    return { reranked: true, results: [...scored, ...results.slice(topN)] };
  } catch (e) {
    console.warn('[rerank] failed, using original order:', e.message);
    return { reranked: false, results };
  }
}

// HyDE: ให้ LLM เขียน "คำตอบจำลอง" แล้วเอาไป embed หาเอกสารจริง (แก้คำถามสั้น/คลุมเครือ)
export async function hydeExpand(query) {
  if (!isLLMAvailable()) return null;
  const openai = getClient();
  try {
    const res = await openai.chat.completions.create({
      model: process.env.LLM_MODEL || 'deepseek-chat',
      messages: [{
        role: 'user',
        content: `เขียนคำตอบจำลองสั้นๆ (2-3 ประโยค) สำหรับคำถามนี้ เสมือนเป็นข้อมูลจากระบบ HR บริษัท ไม่ต้องถูกทุกประการ เอาไว้ใช้ค้นเอกสาร: "${query}"`,
      }],
      temperature: 0.7,
      max_tokens: 200,
    });
    return (res.choices?.[0]?.message?.content || '').trim() || null;
  } catch (e) {
    console.warn('[hyde] failed:', e.message);
    return null;
  }
}
