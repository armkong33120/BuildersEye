// build-vectors.js — CLI: สร้าง vector index จาก registry (chunk → embed → store)
// ใช้: node build-vectors.js [--max=N]
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { getActiveEmployees, getSchema } from './employeeRegistry.js';
import { employeesToChunks } from './chunker.js';
import { orgDocsToChunks } from './orgDocs.js';
import { embedTexts } from './localEmbedder.js';
import { createVectorWriter } from './vectorStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const maxArg = process.argv.find(a => a.startsWith('--max='));
const MAX = maxArg ? Number(maxArg.split('=')[1]) : Infinity;
const BATCH = 32;

const employees = getActiveEmployees();
const schema = getSchema();
let chunks = employeesToChunks(employees, schema);

// + org-level docs (master index, dashboards, registries) จาก repo demo dir
const orgDir = path.join(__dirname, '..', 'src', 'data', 'hr_onedrive_demo');
const orgChunks = orgDocsToChunks(orgDir);
console.log(`📄 employee chunks: ${chunks.length} | 🏢 org-doc chunks: ${orgChunks.length}`);
chunks = [...chunks, ...orgChunks];

if (chunks.length > MAX) chunks = chunks.slice(0, MAX);

console.log(`🧠 Building vectors: ${chunks.length} chunks (model: Xenova/multilingual-e5-small)`);
const t0 = Date.now();
const writer = createVectorWriter();

for (let i = 0; i < chunks.length; i += BATCH) {
  const batch = chunks.slice(i, i + BATCH);
  const vectors = await embedTexts(batch.map(c => c.text));
  batch.forEach((c, j) => writer.append(c, vectors[j]));
  if ((i / BATCH) % 10 === 0) {
    const pct = ((i / chunks.length) * 100).toFixed(0);
    const eta = (((Date.now() - t0) / (i + 1)) * (chunks.length - i) / 1000).toFixed(0);
    console.log(`  ${i}/${chunks.length} (${pct}%) ETA ~${eta}s`);
  }
}

const total = writer.finish('Xenova/multilingual-e5-small');
console.log(`✅ Done: ${total} vectors in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
