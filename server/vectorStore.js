// vectorStore.js — Vector store แบบไฟล์ (JSONL) + cosine search ในหน่วยความจำ
// ขนาด 150 คน (~10k chunks) ไม่จำเป็นต้องมี Vector DB แยก — ตามแผน v2
// โครงสร้าง meta พร้อมย้ายไป Neon pgvector ทีหลังได้ (chunk = row, embedding = vector)
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTOR_DIR = path.join(__dirname, '.data', 'vectors');
const CHUNKS_FILE = path.join(VECTOR_DIR, 'chunks.jsonl');
const META_FILE = path.join(VECTOR_DIR, 'meta.json');

let _index = null; // [{id, text, meta, vector}]
let _indexMtime = 0;

function ensureDir() {
  if (!fs.existsSync(VECTOR_DIR)) fs.mkdirSync(VECTOR_DIR, { recursive: true });
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}

export function vectorsExist() { return fs.existsSync(CHUNKS_FILE); }

export function getVectorMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf-8')); } catch { return null; }
}

// เขียน chunks+vectors ทับไฟล์เดิม (build ใหม่ทั้งชุด — ง่ายและ atomic พอสำหรับขนาดนี้)
export function createVectorWriter() {
  ensureDir();
  if (fs.existsSync(CHUNKS_FILE)) fs.unlinkSync(CHUNKS_FILE);
  let count = 0;
  return {
    append(chunk, vector) {
      fs.appendFileSync(CHUNKS_FILE, JSON.stringify({ id: chunk.id, text: chunk.text, meta: chunk.meta, vector }) + '\n');
      count++;
    },
    finish(model) {
      fs.writeFileSync(META_FILE, JSON.stringify({ model, count, builtAt: new Date().toISOString() }, null, 2));
      _index = null; // invalidate cache
      return count;
    },
  };
}

async function loadIndex() {
  if (!fs.existsSync(CHUNKS_FILE)) return null;
  const mtime = fs.statSync(CHUNKS_FILE).mtimeMs;
  if (_index && mtime === _indexMtime) return _index; // cache ยังสด
  const idx = [];
  const rl = readline.createInterface({ input: fs.createReadStream(CHUNKS_FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) idx.push(JSON.parse(line));
  }
  _index = idx;
  _indexMtime = mtime;
  return idx;
}

// scopeCodes: null = ทั้งหมด, Set = จำกัดรายคน; allowSensitive=false → ตัด chunk ลับทิ้ง
export async function searchVectors(queryVector, { k = 5, scopeCodes = null, allowSensitive = false, sheet = null } = {}) {
  const idx = await loadIndex();
  if (!idx) return { available: false, results: [] };
  const scored = [];
  for (const item of idx) {
    const m = item.meta || {};
    if (!allowSensitive && m.sensitivity === 'sensitive') continue;
    if (scopeCodes && !scopeCodes.has(m.code)) continue;
    if (sheet && m.sheet !== sheet) continue;
    scored.push({ item, score: cosine(queryVector, item.vector) });
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    available: true,
    results: scored.slice(0, k).map(({ item, score }) => ({
      id: item.id,
      score: Number(score.toFixed(4)),
      text: item.text,
      meta: item.meta,
    })),
  };
}

export function getVectorDir() { return VECTOR_DIR; }
