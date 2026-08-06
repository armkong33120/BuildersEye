// blobSync.js — ดึง vector store จาก Azure Blob เมื่อไฟล์ local ไม่มี (cloud boot)
// ทำให้ container (ephemeral) ได้ vectors ล่าสุดโดยไม่ต้องฝัง 92MB ใน image
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTOR_DIR = path.join(__dirname, '.data', 'vectors');
const CHUNKS_FILE = path.join(VECTOR_DIR, 'chunks.jsonl');
const META_FILE = path.join(VECTOR_DIR, 'meta.json');

export async function ensureVectorsFromBlob(log = console.log) {
  if (fs.existsSync(CHUNKS_FILE)) return { downloaded: false, reason: 'already present' };
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return { downloaded: false, reason: 'no AZURE_STORAGE_CONNECTION_STRING' };

  try {
    const { BlobServiceClient } = await import('@azure/storage-blob');
    const service = BlobServiceClient.fromConnectionString(connStr);
    const container = service.getContainerClient(process.env.VECTOR_BLOB_CONTAINER || 'vectors');
    if (!fs.existsSync(VECTOR_DIR)) fs.mkdirSync(VECTOR_DIR, { recursive: true });

    const t0 = Date.now();
    const blob = container.getBlobClient('chunks.jsonl');
    await blob.downloadToFile(CHUNKS_FILE);
    try {
      const meta = container.getBlobClient('meta.json');
      await meta.downloadToFile(META_FILE);
    } catch { /* meta optional */ }
    const mb = (fs.statSync(CHUNKS_FILE).size / 1048576).toFixed(1);
    log(`[blob] vectors downloaded: ${mb}MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return { downloaded: true, mb };
  } catch (e) {
    log('[blob] download failed (semantic search จะปิดอยู่):', e.message);
    return { downloaded: false, reason: e.message };
  }
}
