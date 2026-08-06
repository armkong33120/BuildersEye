// blobSync.js — ดึง vector store + embedding model cache จาก Azure Blob เมื่อไฟล์ local ไม่มี (cloud boot)
// ทำให้ container (ephemeral) ได้ vectors + model ล่าสุดโดยไม่ต้องฝังใน image (image เบา → cold start เร็วขึ้น)
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTOR_DIR = path.join(__dirname, '.data', 'vectors');
const CHUNKS_FILE = path.join(VECTOR_DIR, 'chunks.jsonl');
const META_FILE = path.join(VECTOR_DIR, 'meta.json');

export async function ensureVectorsFromBlob(log = console.log) {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return { downloaded: false, reason: 'no AZURE_STORAGE_CONNECTION_STRING' };

  const needVectors = !fs.existsSync(CHUNKS_FILE);
  const modelDir = process.env.EMBED_CACHE_DIR || '';
  const needModel = Boolean(modelDir) && !fs.existsSync(path.join(modelDir, '.cache'));
  if (!needVectors && !needModel) return { downloaded: false, reason: 'already present' };

  try {
    const { BlobServiceClient } = await import('@azure/storage-blob');
    const service = BlobServiceClient.fromConnectionString(connStr);
    const container = service.getContainerClient(process.env.VECTOR_BLOB_CONTAINER || 'vectors');

    if (needVectors) {
      if (!fs.existsSync(VECTOR_DIR)) fs.mkdirSync(VECTOR_DIR, { recursive: true });
      const t0 = Date.now();
      await container.getBlobClient('chunks.jsonl').downloadToFile(CHUNKS_FILE);
      try { await container.getBlobClient('meta.json').downloadToFile(META_FILE); } catch { /* optional */ }
      const mb = (fs.statSync(CHUNKS_FILE).size / 1048576).toFixed(1);
      log(`[blob] vectors downloaded: ${mb}MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

    if (needModel) {
      const t0 = Date.now();
      const tarPath = path.join(modelDir, 'model-cache.tar.gz');
      fs.mkdirSync(modelDir, { recursive: true });
      await container.getBlobClient('model-cache.tar.gz').downloadToFile(tarPath);
      execSync(`tar -xzf "${tarPath}" -C "${modelDir}"`);
      fs.unlinkSync(tarPath);
      log(`[blob] model cache downloaded+extracted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

    return { downloaded: true };
  } catch (e) {
    log('[blob] download failed (semantic search อาจยังไม่พร้อม):', e.message);
    return { downloaded: false, reason: e.message };
  }
}

