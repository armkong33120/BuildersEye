// upload-vectors.js — อัปโหลด vector store ขึ้น Azure Blob (หลัง build เสร็จ)
// ใช้: node upload-vectors.js   (ต้องมี AZURE_STORAGE_CONNECTION_STRING ใน env หรือไฟล์ /tmp/stg_conn.txt)
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTOR_DIR = path.join(__dirname, '.data', 'vectors');
const CHUNKS_FILE = path.join(VECTOR_DIR, 'chunks.jsonl');
const META_FILE = path.join(VECTOR_DIR, 'meta.json');

const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING
  || (fs.existsSync('/tmp/stg_conn.txt') ? fs.readFileSync('/tmp/stg_conn.txt', 'utf-8').trim() : '');

if (!connStr) { console.error('❌ ไม่มี connection string'); process.exit(1); }
if (!fs.existsSync(CHUNKS_FILE)) { console.error('❌ ไม่มี chunks.jsonl — build ก่อน'); process.exit(1); }

const { BlobServiceClient } = await import('@azure/storage-blob');
const service = BlobServiceClient.fromConnectionString(connStr);
const container = service.getContainerClient(process.env.VECTOR_BLOB_CONTAINER || 'vectors');

const mb = (fs.statSync(CHUNKS_FILE).size / 1048576).toFixed(1);
console.log(`⬆️ uploading chunks.jsonl (${mb}MB)...`);
const t0 = Date.now();
await container.getBlockBlobClient('chunks.jsonl').uploadFile(CHUNKS_FILE, { overwrite: true });
if (fs.existsSync(META_FILE)) {
  await container.getBlockBlobClient('meta.json').uploadFile(META_FILE, { overwrite: true });
}
console.log(`✅ uploaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
