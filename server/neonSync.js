// neonSync.js — sync registry ระหว่าง Neon (ถาวร) ↔ JSON cache (เร็ว)
// ทิศทาง: local (มี OneDrive) → push ขึ้น Neon หลัง build | cloud → pull ลงมาตอน boot
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isNeonEnabled, getPool, initNeonSchema } from './neonStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = path.join(__dirname, '.data', 'registry');
const EMP_FILE = path.join(REGISTRY_DIR, 'employees.json');
const SCHEMA_FILE = path.join(REGISTRY_DIR, 'schema.json');

// cloud boot: ดึง registry จาก Neon ลงมาเป็น JSON cache (ถ้า Neon มีข้อมูล)
export async function pullRegistryFromNeon(log = console.log) {
  if (!isNeonEnabled()) return { pulled: false, reason: 'no DATABASE_URL' };
  try {
    await initNeonSchema();
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM employees`);
    if (!rows.length) return { pulled: false, reason: 'neon empty' };

    const employees = {};
    for (const r of rows) {
      employees[r.code] = {
        code: r.code, pk: r.pk, name: r.name, department: r.department,
        jobTitle: r.job_title, roleGroup: r.role_group, managerCode: r.manager_code,
        managerName: r.manager_name, email: r.email, employmentStatus: r.employment_status,
        status: r.status, fileName: r.file_name, fileHash: r.file_hash,
        sheetNames: r.sheet_names || [], profileHeaders: r.profile_headers || [],
        rowCounts: r.row_counts || {}, sheets: r.sheets || {},
        firstSeen: r.first_seen, lastSeen: r.last_seen, removedAt: r.removed_at,
        version: r.version,
      };
    }
    if (!fs.existsSync(REGISTRY_DIR)) fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    fs.writeFileSync(EMP_FILE, JSON.stringify(employees, null, 1));

    const meta = await pool.query(`SELECT value FROM registry_meta WHERE key='schema'`);
    if (meta.rows.length) fs.writeFileSync(SCHEMA_FILE, JSON.stringify(meta.rows[0].value, null, 1));

    log(`[neon] registry pulled: ${rows.length} employees`);
    return { pulled: true, count: rows.length };
  } catch (e) {
    log('[neon] pull failed (ใช้ local cache ต่อ):', e.message);
    return { pulled: false, reason: e.message };
  }
}

// local → push ขึ้น Neon หลัง buildRegistry (fire-and-forget)
export async function pushRegistryToNeon(employees, schema, log = console.log) {
  if (!isNeonEnabled()) return { pushed: false };
  try {
    await initNeonSchema();
    const pool = getPool();
    let n = 0;
    for (const e of Object.values(employees)) {
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
      n++;
    }
    await pool.query(
      `INSERT INTO registry_meta (key, value, updated_at) VALUES ('schema', $1, now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [JSON.stringify(schema)]
    );
    log(`[neon] registry pushed: ${n} employees`);
    return { pushed: true, count: n };
  } catch (e) {
    log('[neon] push failed:', e.message);
    return { pushed: false, reason: e.message };
  }
}
