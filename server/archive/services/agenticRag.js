// agenticRag.js — Agentic RAG with Self-Correction & Re-Querying
// ตาม AI Engineering Guidebook (หน้า 143, 181): วงวน Self-Reflection ประเมินคุณภาพ RAG และ Re-query อัตโนมัติ

export function evaluateConfidence(query, results) {
  if (!results || results.length === 0) return { score: 0, status: 'EMPTY' };
  let topScore = results[0]?.score || 0;
  let count = results.length;
  // Score range normalized 0.0 - 1.0
  let normScore = topScore > 1.5 ? 0.95 : Math.min(1.0, topScore);
  
  if (normScore < 0.60) return { score: normScore, status: 'LOW_CONFIDENCE', shouldReQuery: true };
  if (count < 2) return { score: normScore, status: 'INSUFFICIENT_CONTEXT', shouldReQuery: true };
  return { score: normScore, status: 'HIGH_CONFIDENCE', shouldReQuery: false };
}

export function reformulateQuery(originalQuery, attempt = 1) {
  let query = originalQuery.trim();

  const synonyms = {
    'notebook': 'Notebook โน้ตบุ๊ก คอมพิวเตอร์พกพา',
    'ใครเป็น': 'ตำแหน่ง รายชื่อ หัวหน้า Manager',
    'เงินเดือน': 'Salary ค่าตอบแทน เงินเดือน',
    'โปรเจกต์': 'Project โครงการ ผลงาน',
    'ตักเตือน': 'Warning วินัย ข้อผิดพลาด Case',
  };

  for (const [key, expansion] of Object.entries(synonyms)) {
    if (query.toLowerCase().includes(key)) {
      query = `${query} (${expansion})`;
      break;
    }
  }

  if (attempt > 1) {
    query += ' ข้อมูลพนักงาน';
  }
  return query;
}

export async function executeAgenticRAG(query, searchFn, maxAttempts = 2) {
  let currentQuery = query;
  let attempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const results = await searchFn(currentQuery);
    const evalResult = evaluateConfidence(currentQuery, results);

    attempts.push({
      attempt,
      query: currentQuery,
      resultCount: results.length,
      confidence: evalResult.score,
      status: evalResult.status,
    });

    if (!evalResult.shouldReQuery || attempt === maxAttempts) {
      return {
        finalResults: results,
        attempts,
        agenticSummary: `Completed in ${attempt} attempt(s) with confidence ${(evalResult.score * 100).toFixed(1)}%`,
      };
    }

    // Mini-loop: Self-Correction Re-Querying
    currentQuery = reformulateQuery(query, attempt + 1);
  }
}
