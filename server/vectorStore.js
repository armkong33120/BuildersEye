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

export function vectorsExist() {
  // Neon path: vectors อยู่ใน Postgres ไม่ต้องมีไฟล์ local
  if (process.env.DATABASE_URL) return true;
  return fs.existsSync(CHUNKS_FILE);
}

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
// whoBias=true → คำถาม "ใคร/คนไหน" ให้ขยับผลคน (employee) ขึ้น, ลด orgdoc ลง
export async function searchVectors(queryVector, { k = 5, scopeCodes = null, allowSensitive = false, sheet = null, whoBias = false } = {}) {
  // เส้นทาง Neon pgvector (ถ้ามี DATABASE_URL) — ไม่ต้องโหลด 129MB เข้า RAM
  if (process.env.DATABASE_URL) {
    try {
      return await searchVectorsNeon(queryVector, { k, scopeCodes, allowSensitive, sheet, whoBias });
    } catch (e) {
      console.warn('[vector] neon search failed, fallback ไฟล์:', e.message);
    }
  }
  const idx = await loadIndex();
  if (!idx) return { available: false, results: [] };
  const scored = [];
  for (const item of idx) {
    const m = item.meta || {};
    if (!allowSensitive && m.sensitivity === 'sensitive') continue;
    if (isReferenceDoc(m)) continue; // index/directory ซ้ำ → ข้าม
    // orgdoc (ข้อมูลระดับบริษัท ไม่ผูกกับบุคคล) → ทุก role เห็นได้ (ยกเว้น sensitive ที่กรองไปแล้ว)
    if (m.kind !== 'orgdoc' && scopeCodes && !scopeCodes.has(m.code)) continue;
    if (sheet && m.sheet !== sheet) continue;
    let score = cosine(queryVector, item.vector);
    if (whoBias) score = applyWhoBias(score, m);
    scored.push({ item, score });
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

// เอกสาร "index/directory/แผนที่อ้างอิง" เป็นข้อมูลซ้ำจากโปรไฟล์จริง → กันไว้ไม่ให้แย่งคำตอบ (เช่น "IT Manager")
const REFERENCE_DOC_BLOCKLIST = ['cross_reference', 'employee_master', 'employee_directory', 'master_index', 'hr_master', '_index'];
const isReferenceDoc = (m) => (m.kind === 'orgdoc') && REFERENCE_DOC_BLOCKLIST.some(k => (m.name || '').toLowerCase().includes(k.toLowerCase()));

// person-bias: คำถาม "ใครคือ X" ควรเจอตัวคน → คนขึ้น, เอกสารอบกองลด
function applyWhoBias(score, meta) {
  const isPerson = meta.department && meta.kind !== 'orgdoc';
  return isPerson ? score * 1.06 : score * 0.97;
}

// pgvector: cosine distance query ใน Postgres โดยตรง (HNSW index) — ถามแถวเยอะๆ แล้ว re-rank เอง
async function searchVectorsNeon(queryVector, { k, scopeCodes, allowSensitive, sheet, whoBias }) {
  const { getPool } = await import('./neonStore.js');
  const pool = getPool();
  const vecLiteral = `[${queryVector.join(',')}]`;
  const scopeArr = scopeCodes ? [...scopeCodes] : null;
  const fetchN = whoBias ? Math.min(k * 4, 200) : k;
  const { rows } = await pool.query(
    `SELECT id, text, meta, 1 - (embedding <=> $1::vector) AS score
     FROM chunks
     WHERE ($2::boolean OR meta->>'sensitivity' <> 'sensitive')
       AND NOT (meta->>'kind' = 'orgdoc' AND (
            meta->>'name' ILIKE '%cross_reference%' OR meta->>'name' ILIKE '%employee_master%'
            OR meta->>'name' ILIKE '%employee_directory%' OR meta->>'name' ILIKE '%master_index%'
            OR meta->>'name' ILIKE '%hr_master%'))
       AND ($3::text[] IS NULL OR meta->>'kind' = 'orgdoc' OR meta->>'code' = ANY($3))
       AND ($4::text IS NULL OR meta->>'sheet' = $4)
     ORDER BY embedding <=> $1::vector
     LIMIT $5`,
    [vecLiteral, allowSensitive, scopeArr, sheet, fetchN]
  );
  let list = rows.map(r => ({ id: r.id, score: Number(r.score), text: r.text, meta: r.meta }));
  if (whoBias) list = list.map(r => ({ ...r, score: applyWhoBias(r.score, r.meta) }));
  list.sort((a, b) => b.score - a.score);
  list = list.slice(0, k);
  return {
    available: true,
    results: list.map(r => ({ id: r.id, score: Number(r.score.toFixed(4)), text: r.text, meta: r.meta })),
  };
}

export function getVectorDir() { return VECTOR_DIR; }
