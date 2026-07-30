#!/usr/bin/env python3
"""LOOP 18: Vector Search Engine — write vectorEngine.js + update index.js + chatController.js"""
import os, subprocess

BASE = "/Users/arm/AI Test/mail-onedrive-org-graph/server"

# ── Write vectorEngine.js ──
vec = """import fs from 'fs';
import path from 'path';
import { getClient, isLLMAvailable } from './llmClient.js';

const CACHE_FILE = path.join(process.cwd(), 'server', '.cache', 'vectors.json');
let vectorIndex = [];

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function buildVectorIndex(flatIndex) {
  if (!isLLMAvailable()) return;
  const openai = getClient();
  if (!openai) return;
  if (fs.existsSync(CACHE_FILE)) {
    vectorIndex = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log('[vector] Loaded ' + vectorIndex.length + ' vectors from cache');
    return;
  }
  console.log('[vector] Building vector index...');
  const textsToEmbed = flatIndex
    .filter(r => r.content && isNaN(r.content) && r.content.length > 5)
    .map(r => ({ pk: r.employeeId, text: '[' + (r.department || '') + '] ' + r.sheetName + ' -> ' + r.content }));
  for (let i = 0; i < textsToEmbed.length; i += 1000) {
    const batch = textsToEmbed.slice(i, i + 1000);
    try {
      const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: batch.map(b => b.text) });
      res.data.forEach((d, idx) => { vectorIndex.push({ pk: batch[idx].pk, text: batch[idx].text, vector: d.embedding }); });
      console.log('[vector] Embedded ' + vectorIndex.length + ' records');
    } catch (e) { console.error('[vector] Embedding error:', e.message); return; }
  }
  const cacheDir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(vectorIndex));
  console.log('[vector] Built and cached ' + vectorIndex.length + ' vectors');
}

export async function semanticSearch(query, topK = 15) {
  if (!isLLMAvailable() || vectorIndex.length === 0) return [];
  const openai = getClient();
  if (!openai) return [];
  try {
    const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: query });
    const queryVector = res.data[0].embedding;
    const scored = vectorIndex.map(item => ({ pk: item.pk, text: item.text, score: cosineSimilarity(queryVector, item.vector) }));
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  } catch (e) { console.error('[vector] Search error:', e.message); return []; }
}
"""
with open(os.path.join(BASE, "vectorEngine.js"), "w") as f:
    f.write(vec)
print("Wrote vectorEngine.js")

# ── Update index.js ──
idx = open(os.path.join(BASE, "index.js"), "r").read()
idx = idx.replace(
    "import { initDatabase } from './sqlEngine.js';",
    "import { initDatabase } from './sqlEngine.js';\nimport { buildVectorIndex } from './vectorEngine.js';"
)
idx = idx.replace(
    "initDatabase(flatIndex);",
    "initDatabase(flatIndex);\n  buildVectorIndex(flatIndex);"
)
open(os.path.join(BASE, "index.js"), "w").write(idx)
print("Updated index.js")

# ── Update chatController.js ──
cc = open(os.path.join(BASE, "chatController.js"), "r").read()
cc = cc.replace(
    "import { generateAndRunSQL, isDBReady } from './sqlEngine.js';",
    "import { generateAndRunSQL, isDBReady } from './sqlEngine.js';\nimport { semanticSearch } from './vectorEngine.js';"
)
open(os.path.join(BASE, "chatController.js"), "w").write(cc)
print("Updated chatController.js")

# ── Build ──
r = subprocess.run(["npm", "run", "build"], cwd="/Users/arm/AI Test/mail-onedrive-org-graph", capture_output=True, text=True)
print("Build:", "OK" if "built in" in (r.stdout + r.stderr) else "FAIL")
for line in (r.stdout + r.stderr).split("\n"):
    if "built in" in line: print(line)
print("\nLOOP 18 complete.")