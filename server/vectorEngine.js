import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { getClient, isLLMAvailable } from './llmClient.js';

const CACHE_FILE = path.join(process.cwd(), 'server', '.cache', 'vectors.jsonl');
let vectorIndex = [];

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function buildVectorIndex(flatIndex) {
  if (!isLLMAvailable()) return;
  const openai = getClient();
  
  if (fs.existsSync(CACHE_FILE)) {
    const rl = readline.createInterface({
      input: fs.createReadStream(CACHE_FILE),
      crlfDelay: Infinity
    });
    for await (const line of rl) {
      if (line.trim()) vectorIndex.push(JSON.parse(line));
    }
    console.log(`[vector] Loaded ${vectorIndex.length} vectors from cache`);
    return;
  }
  
  console.log(`[vector] Building vector index. This takes 10-20 seconds...`);
  const textsToEmbed = flatIndex
    .filter(r => r.content && isNaN(r.content) && r.content.length > 5) // Skip numbers
    .map(r => ({ pk: r.employeeId, text: `[${r.department}] ${r.sheetName} -> ${r.content}` }));

  const cacheDir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);

  for (let i = 0; i < textsToEmbed.length; i += 1000) {
    const batch = textsToEmbed.slice(i, i + 1000);
    const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: batch.map(b => b.text) });
    res.data.forEach((d, idx) => {
      const item = { pk: batch[idx].pk, text: batch[idx].text, vector: d.embedding };
      vectorIndex.push(item);
      fs.appendFileSync(CACHE_FILE, JSON.stringify(item) + '\n');
    });
    console.log(`[vector] Embedded ${vectorIndex.length} records`);
  }
  console.log(`[vector] Vector index built and cached!`);
}

export async function semanticSearch(query, topK = 15) {
  if (!isLLMAvailable() || vectorIndex.length === 0) return [];
  const openai = getClient();
  const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: query });
  const queryVector = res.data[0].embedding;
  
  const scored = vectorIndex.map(item => ({ ...item, score: cosineSimilarity(queryVector, item.vector) }));
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}