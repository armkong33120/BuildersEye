// vectorStore.js — Vector store แบบไฟล์ (JSONL) + cosine search ในหน่วยความจำ
// ขนาด 150 คน (~10k chunks) ไม่จำเป็นต้องมี Vector DB แยก — ตามแผน v2
// โครงสร้าง meta พร้อมย้ายไป Neon pgvector ทีหลังได้ (chunk = row, embedding = vector)
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTOR_DIR = path.join(__dirname, '..', '.data', 'vectors');
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
// sheetMentions: Set<sheetName> จาก detectSheetMentions() — sheetBias boost + coverage guarantee
// sheetBoost: multiplier สำหรับ chunk ที่ sheet ถูก mention (default 1.10, env RAG_SHEET_BOOST)
export async function searchVectors(queryVector, { k = 5, scopeCodes = null, allowSensitive = false, sheet = null, whoBias = false, sheetMentions = null, sheetBoost = 1.10, coverage = 2, minScore = Number(process.env.RAG_MIN_SCORE || 0.80) } = {}) {
  // เส้นทาง Neon pgvector (ถ้ามี DATABASE_URL) — ไม่ต้องโหลด 129MB เข้า RAM
  if (process.env.USE_NEON_VECTORS === 'true' && process.env.DATABASE_URL) {
    try {
      return await searchVectorsNeon(queryVector, { k, scopeCodes, allowSensitive, sheet, whoBias, sheetMentions, sheetBoost, coverage, minScore });
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
    // Layer 2 — sheetBias: chunk ที่ sheet ถูก mention → boost (แก้ dataset drowning)
    if (sheetMentions && sheetMentions.has(m.sheet)) score *= sheetBoost;
    if (minScore > 0 && score < minScore) continue;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // Layer 2 — coverage guarantee: ถ้า query mention N sheets → บังคับให้แต่ละ sheet
  // ผ่าน top-coverage จำนวนอย่างน้อย `coverage` ตัว (สลับสลับกับ global ranking)
  const results = scored.slice(0, k).map(({ item, score }) => ({
    id: item.id,
    score: Number(score.toFixed(4)),
    text: item.text,
    meta: item.meta,
  }));
  if (sheetMentions && sheetMentions.size > 0 && results.length > 0) {
    const final = [];
    const picked = new Set();
    // รอบ 1: per-sheet top-coverage
    for (const sheetName of sheetMentions) {
      let n = 0;
      for (const r of scored) {
        if (r.item.meta?.sheet !== sheetName) continue;
        if (picked.has(r.item.id)) continue;
        final.push({ id: r.item.id, score: Number(r.score.toFixed(4)), text: r.item.text, meta: r.item.meta });
        picked.add(r.item.id);
        if (++n >= coverage) break;
      }
    }
    // รอบ 2: เติม global top จนครบ k
    for (const r of scored) {
      if (final.length >= k) break;
      if (picked.has(r.item.id)) continue;
      final.push({ id: r.item.id, score: Number(r.score.toFixed(4)), text: r.item.text, meta: r.item.meta });
      picked.add(r.item.id);
    }
    return { available: true, results: final.slice(0, k) };
  }

  return {
    available: true,
    results,
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
async function searchVectorsNeon(queryVector, { k, scopeCodes, allowSensitive, sheet, whoBias, sheetMentions = null, sheetBoost = 1.10, coverage = 2, minScore = 0.85 }) {
  const { getPool } = await import('./neonStore.js');
  const pool = getPool();
  const vecLiteral = `[${queryVector.join(',')}]`;
  const conditions = [];
  if (!allowSensitive) conditions.push("meta->>'sensitivity' != 'sensitive'");
  if (scopeCodes && scopeCodes.size > 0) {
    const codesLiteral = Array.from(scopeCodes).map(c => `'${c.replace(/'/g, "''")}'`).join(',');
    conditions.push(`(meta->>'kind' = 'orgdoc' OR meta->>'code' IN (${codesLiteral}))`);
  }
  if (sheet) conditions.push(`meta->>'sheet' = '${sheet.replace(/'/g, "''")}'`);
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT id, text, meta, (1 - (embedding <=> '${vecLiteral}'::vector)) AS score FROM chunks ${whereSql} ORDER BY embedding <=> '${vecLiteral}'::vector LIMIT 100`
  );
  let list = rows.map(r => ({ id: r.id, score: Number(r.score), text: r.text, meta: r.meta }));
  if (whoBias) list = list.map(r => ({ ...r, score: applyWhoBias(r.score, r.meta) }));
  // Layer 2 — sheetBias (แก้ dataset drowning) เหมือน file path
  if (sheetMentions && sheetMentions.size > 0) {
    list = list.map(r => (sheetMentions.has(r.meta?.sheet) ? { ...r, score: r.score * sheetBoost } : r));
  }
  if (minScore > 0) list = list.filter(r => r.score >= minScore);
  list.sort((a, b) => b.score - a.score);

  // coverage guarantee: ถ้า mention sheets → บังคับแต่ละ sheet ผ่าน coverage ตัว
  if (sheetMentions && sheetMentions.size > 0 && list.length > 0) {
    const final = [];
    const picked = new Set();
    for (const sheetName of sheetMentions) {
      let n = 0;
      for (const r of list) {
        if (r.meta?.sheet !== sheetName || picked.has(r.id)) continue;
        final.push(r); picked.add(r.id);
        if (++n >= coverage) break;
      }
    }
    for (const r of list) {
      if (final.length >= k || picked.has(r.id)) continue;
      final.push(r); picked.add(r.id);
    }
    list = final.slice(0, k);
  } else {
    list = list.slice(0, k);
  }
  return {
    available: true,
    results: list.map(r => ({ id: r.id, score: Number(r.score.toFixed(4)), text: r.text, meta: r.meta })),
  };
}

export function getVectorDir() { return VECTOR_DIR; }
