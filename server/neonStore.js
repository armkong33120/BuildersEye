// neonStore.js — Neon Postgres (pgvector) เป็น Source of Truth ถาวร
// ใช้เมื่อมี DATABASE_URL; ถ้าไม่มี → fallback ไฟล์ JSON (ทุก caller ใช้ร่วมกันได้)
import pg from 'pg';

const { Pool } = pg;
let _pool = null;

export function isNeonEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return _pool;
}

export async function initNeonSchema() {
  const pool = getPool();
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      code TEXT PRIMARY KEY,
      pk INTEGER,
      name TEXT,
      department TEXT,
      job_title TEXT,
      role_group TEXT,
      manager_code TEXT,
      manager_name TEXT,
      email TEXT,
      employment_status TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      file_name TEXT,
      file_hash TEXT,
      sheet_names JSONB,
      profile_headers JSONB,
      row_counts JSONB,
      sheets JSONB,
      first_seen TIMESTAMPTZ,
      last_seen TIMESTAMPTZ,
      removed_at TIMESTAMPTZ,
      version INTEGER DEFAULT 1
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      meta JSONB NOT NULL,
      embedding vector(384),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registry_meta (
      key TEXT PRIMARY KEY,
      value JSONB,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`);
  // indexes (สร้างครั้งแรกช้าหน่อย ครั้งต่อไปข้าม)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chunks_code ON chunks ((meta->>'code'))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chunks_kind ON chunks ((meta->>'kind'))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_employees_status ON employees (status)`);
  return true;
}

export async function ensureHnswIndex() {
  // HNSW index สร้างหลังมีข้อมูล (เร็วกว่าสร้างตอนตารางว่าง)
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops)`);
}
