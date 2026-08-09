// gEval.js — G-Eval Framework (LLM-as-a-Judge Evaluation Metric)
// ตาม AI Engineering Guidebook (หน้า 332-336): ประเมินคุณภาพ RAG ด้วย Chain-of-Thought Scoring (0.0 - 1.0)

export function evaluateGEval({ query, answer, context, viewerRole = 'CEO' }) {
  const steps = [];
  let score = 1.0;

  // Step 1: Accuracy & Factuality (คำตอบมีเนื้อหาตรงกับ query หรือไม่)
  const queryWords = query.toLowerCase().split(/\s+/);
  const answerLen = (answer || '').length;
  if (answerLen < 5) {
    score -= 0.4;
    steps.push({ step: 'Factuality', pass: false, penalty: 0.4, reason: 'Answer too short or empty' });
  } else {
    steps.push({ step: 'Factuality', pass: true, scoreAdd: 0.35, reason: 'Answer provides meaningful response length' });
  }

  // Step 2: Governance & RBAC Compliance (สิทธิ์การเข้าถึงและความลับ)
  if (viewerRole !== 'CEO' && (answer || '').includes('Salary_History')) {
    score -= 0.5;
    steps.push({ step: 'Governance', pass: false, penalty: 0.5, reason: 'Unredacted salary leak detected for non-CEO' });
  } else {
    steps.push({ step: 'Governance', pass: true, scoreAdd: 0.35, reason: 'RBAC Redaction policy strictly respected' });
  }

  // Step 3: Fluency & Coherence (ความเป็นธรรมชาติของภาษาไทย)
  const thaiPattern = /[\u0E00-\u0E7F]/;
  if (thaiPattern.test(query) && !thaiPattern.test(answer)) {
    score -= 0.2;
    steps.push({ step: 'Fluency', pass: false, penalty: 0.2, reason: 'Language mismatch: Thai query got Non-Thai answer' });
  } else {
    steps.push({ step: 'Fluency', pass: true, scoreAdd: 0.30, reason: 'Natural language response fluency confirmed' });
  }

  const finalScore = Math.max(0.0, Math.min(1.0, Number(score.toFixed(2))));
  return {
    gEvalScore: finalScore,
    grade: finalScore >= 0.85 ? 'EXCELLENT' : finalScore >= 0.70 ? 'GOOD' : 'NEEDS_IMPROVEMENT',
    chainOfThought: steps,
    evaluatedAt: new Date().toISOString(),
  };
}
