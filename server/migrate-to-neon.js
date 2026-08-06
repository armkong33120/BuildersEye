// migrate-to-neon.js — ย้ายข้อมูลจากไฟล์ local (registry JSON + vectors JSONL) เข้า Neon Postgres
// ใช้: DATABASE_URL=... node migrate-to-neon.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { initNeonSchema, ensureHnswIndex, getPool } from './neonStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMP_FILE = path.join(__dirname, '.data', 'registry', 'employees.json');
const SCHEMA_FILE = path.join(__dirname, '.data', 'registry', 'schema.json');
const CHUNKS_FILE = path.join(__dirname, '.data', 'vectors', 'chunks.jsonl');

const pool = getPool();

// ---------- employees ----------
async function migrateEmployees() {
  const employees = JSON.parse(fs.readFileSync(EMP_FILE, 'utf-8'));
  const entries = Object.values(employees);
  console.log(`👥 migrating ${entries.length} employees...`);
  let n = 0;
  for (const e of entries) {
    await pool.query(
      `INSERT INTO employees (code, pk, name, department, job_title, role_group, manager_code, manager_name, email, employment_status, status, file_name, file_hash, sheet_names, profile_headers, row_counts, sheets, first_seen, last_seen, removed_at, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (code) DO UPDATE SET
         pk=EXCLUDED.pk, name=EXCLUDED.name, department=EXCLUDED.department, job_title=EXCLUDED.job_title,
         role_group=EXCLUDED.role_group, manager_code=EXCLUDED.manager_code, manager_name=EXCLUDED.manager_name,
         email=EXCLUDED.email, employment_status=EXCLUDED.employment_status, status=EXCLUDED.status,
         file_name=EXCLUDED.file_name, file_hash=EXCLUDED.file_hash, sheet_names=EXCLUDED.sheet_names,
         profile_headers=EXCLUDED.profile_headers, row_counts=EXCLUDED.row_counts, sheets=EXCLUDED.sheets,
         last_seen=EXCLUDED.last_seen, removed_at=EXCLUDED.removed_at, version=EXCLUDED.version`,
      [e.code, e.pk, e.name, e.department, e.jobTitle, e.roleGroup, e.managerCode, e.managerName, e.email,
       e.employmentStatus, e.status, e.fileName, e.fileHash,
       JSON.stringify(e.sheetNames || []), JSON.stringify(e.profileHeaders || []),
       JSON.stringify(e.rowCounts || {}), JSON.stringify(e.sheets || {}),
       e.firstSeen || null, e.lastSeen || null, e.removedAt || null, e.version || 1]
    );
    if (++n % 50 === 0) console.log(`  ${n}/${entries.length}`);
  }
  console.log(`✅ employees done (${n})`);

  // schema registry → registry_meta
  if (fs.existsSync(SCHEMA_FILE)) {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf-8'));
    await pool.query(
      `INSERT INTO registry_meta (key, value, updated_at) VALUES ('schema', $1, now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [JSON.stringify(schema)]
    );
    console.log('✅ schema registry → registry_meta');
  }
}

// ---------- chunks (vectors) ----------
async function migrateChunks() {
  const rl = readline.createInterface({ input: fs.createReadStream(CHUNKS_FILE), crlfDelay: Infinity });
  const BATCH = 200;
  let batch = [];
  let total = 0;

  async function flush() {
    if (!batch.length) return;
    const values = [];
    const params = [];
    let p = 1;
    for (const c of batch) {
      values.push(`($${p}, $${p + 1}, $${p + 2}, $${p + 3}::vector)`);
      params.push(c.id, c.text, JSON.stringify(c.meta), `[${c.vector.join(',')}]`);
      p += 4;
    }
    await pool.query(
      `INSERT INTO chunks (id, text, meta, embedding) VALUES ${values.join(',')}
       ON CONFLICT (id) DO UPDATE SET text=EXCLUDED.text, meta=EXCLUDED.meta, embedding=EXCLUDED.embedding, updated_at=now()`,
      params
    );
    total += batch.length;
    if (total % 2000 < BATCH) console.log(`  ${total} chunks...`);
    batch = [];
  }

  console.log('🧠 migrating chunks (vectors)...');
  const t0 = Date.now();
  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  console.log(`✅ chunks done: ${total} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

await initNeonSchema();
await migrateEmployees();
await migrateChunks();
console.log('📐 building HNSW index...');
await ensureHnswIndex();
console.log('🎉 migration complete!');
await pool.end();
process.exit(0);
