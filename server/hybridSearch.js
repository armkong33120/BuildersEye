// hybridSearch.js — Hybrid Retrieval: keyword (inverted index) + vector (cosine) รวมด้วย RRF
// ตาม RAG best practice: BM25-ish keyword เก่ง exact term (รหัส/ชื่อ), vector เก่งความหมาย → รวมกันดีกว่าอันเดียว
import { tokenize } from './registryIngest.js';

// keyword search จาก searchIndex เดิม → [{key, score, entry}]
function keywordSearch(query, flatIndex, searchIndex, limit = 20) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const hitCount = new Map(); // flatIndex idx → count
  for (const t of tokens) {
    const hits = searchIndex.get(t);
    if (!hits) continue;
    for (const idx of hits) hitCount.set(idx, (hitCount.get(idx) || 0) + 1);
  }
  return [...hitCount.entries()]
    .map(([idx, count]) => ({ key: `kw:${idx}`, score: count / tokens.length, entry: flatIndex[idx] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Reciprocal Rank Fusion: score = Σ 1/(k + rank)
function rrfFuse(resultLists, k = 60) {
  const fused = new Map(); // id → {score, payload}
  for (const list of resultLists) {
    list.forEach((item, rank) => {
      const id = item.id;
      const add = 1 / (k + rank + 1);
      const cur = fused.get(id) || { score: 0, payload: item.payload };
      cur.score += add;
      cur.sources = (cur.sources || 0) + 1;
      fused.set(id, cur);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

// main: query → hybrid results
// vectorResults: [{id, score, text, meta}] จาก vectorStore (อาจว่างถ้าไม่มี vectors)
export function hybridFuse(query, flatIndex, searchIndex, vectorResults = [], { k = 10 } = {}) {
  const kw = keywordSearch(query, flatIndex, searchIndex, 25).map(r => ({
    id: `kw:${r.key}`,
    payload: {
      source: 'keyword',
      text: r.entry ? `${r.entry.employeeName} | ${r.entry.department} | ${r.entry.sheetName} | ${r.entry.fieldName}: ${r.entry.content}` : '',
      meta: r.entry ? {
        code: r.entry.employeeCode, pk: r.entry.employeeId, name: r.entry.employeeName,
        department: r.entry.department, sheet: r.entry.sheetName,
        sensitivity: r.entry.confidentialityLevel?.includes('Tier 1') ? 'sensitive' : 'standard',
      } : {},
    },
  }));

  const vec = (vectorResults || []).map(r => ({
    id: `vec:${r.id}`,
    payload: { source: 'vector', text: r.text, meta: r.meta, vectorScore: r.score },
  }));

  // ถ้าไม่มี vector เลย → keyword ล้วน
  if (!vec.length) {
    return { mode: 'keyword-only', results: kw.slice(0, k).map(x => x.payload) };
  }

  const fused = rrfFuse([kw, vec]);
  return {
    mode: 'hybrid',
    results: fused.slice(0, k).map(f => ({ ...f.payload, fusedScore: Number(f.score.toFixed(5)), inBoth: f.sources > 1 })),
  };
}
