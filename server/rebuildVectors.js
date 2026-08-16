// rebuildVectors.js — Reusable vector re-index (chunk → embed → store).
//
// Extracted from build-vectors.js so the sync/reload flow can rebuild the vector
// index in-process after org changes (employee added/removed/deactivated, sheet
// data changed). The local embedder (Xenova multilingual-e5-small) may be
// unavailable on cloud images — callers should catch and fall back gracefully.
import path from 'path';
import { fileURLToPath } from 'url';
import { getActiveEmployees, getSchema } from './employeeRegistry.js';
import { employeesToChunks } from './chunker.js';
import { orgDocsToChunks } from './orgDocs.js';
import { embedTexts } from './localEmbedder.js';
import { createVectorWriter } from './vectorStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function rebuildVectors({ max = Infinity, log = console.log } = {}) {
  const employees = getActiveEmployees();
  const schema = getSchema();
  let chunks = employeesToChunks(employees, schema);

  // + org-level docs (master index, dashboards, registries) from repo demo dir.
  const orgDir = path.join(__dirname, '..', 'src', 'data', 'hr_onedrive_demo');
  const orgChunks = orgDocsToChunks(orgDir);
  chunks = [...chunks, ...orgChunks];
  if (chunks.length > max) chunks = chunks.slice(0, max);

  const BATCH = 32;
  const t0 = Date.now();
  const writer = createVectorWriter();
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await embedTexts(batch.map((c) => c.text));
    batch.forEach((c, j) => writer.append(c, vectors[j]));
    if (log && (i / BATCH) % 10 === 0) {
      log(`[vectors] ${i}/${chunks.length} (${((i / chunks.length) * 100).toFixed(0)}%)`);
    }
  }
  const total = writer.finish('Xenova/multilingual-e5-small');
  return { total, chunks: chunks.length, ms: Date.now() - t0 };
}
