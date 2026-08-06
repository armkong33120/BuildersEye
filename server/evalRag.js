// evalRag.js — วัดคุณภาพ retrieval ด้วย golden set (Recall@k) — เกณฑ์ประจำ promote gate อนาคต
// ใช้: node evalRag.js [--k=5] [--hybrid]
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedOne } from './localEmbedder.js';
import { searchVectors, vectorsExist } from './vectorStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'eval', 'golden.json'), 'utf-8'));
const K = Number((process.argv.find(a => a.startsWith('--k=')) || '--k=5').split('=')[1]);

if (!vectorsExist()) {
  console.error('❌ ยังไม่มี vector index — รัน npm run build:vectors ก่อน');
  process.exit(1);
}

console.log(`📏 RAG Eval — ${golden.length} golden questions, Recall@${K}`);
let hits = 0;
const rows = [];

for (const g of golden) {
  const qv = await embedOne(g.q, { isQuery: true });
  const { results } = await searchVectors(qv, { k: K, allowSensitive: true, scopeCodes: null });
  const hit = results.some(r => {
    const m = r.meta || {};
    if (g.expectCodes && g.expectCodes.includes(m.code)) return true;
    if (g.expectSheets && g.expectSheets.includes(m.sheet)) return true;
    if (g.expectKind && m.kind === g.expectKind) return true;
    return false;
  });
  if (hit) hits++;
  rows.push({ q: g.q, hit, top: results[0] ? `${results[0].meta.code}/${results[0].meta.sheet} (${results[0].score})` : '-' });
  console.log(`  ${hit ? '✅' : '❌'} ${g.q.slice(0, 45)} → top: ${rows[rows.length - 1].top}`);
}

const recall = hits / golden.length;
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Recall@${K}: ${(recall * 100).toFixed(1)}% (${hits}/${golden.length})`);
const report = { at: new Date().toISOString(), k: K, recall, hits, total: golden.length, rows };
fs.writeFileSync(path.join(__dirname, '.data', 'eval-latest.json'), JSON.stringify(report, null, 2));
console.log('💾 report → .data/eval-latest.json');
