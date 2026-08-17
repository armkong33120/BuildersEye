// migrate-access-to-neon.mjs — One-shot migration from JSON files to Neon.
// Reads all 6 JSON stores + audit.jsonl, upserts them to Neon tables.
// Idempotent: safe to re-run (ON CONFLICT DO UPDATE).
// Usage: ACCESS_DB_ADAPTER=neon node scripts/migrate-access-to-neon.mjs
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000 });

const DATA_DIR = process.env.ACCESS_DATA_DIR || new URL('../server/.data/access', import.meta.url).pathname;
const fs = (await import('fs')).default;

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(new URL(name, `file://${DATA_DIR}/`), 'utf-8')); } catch { return fallback; }
}

async function initSchema() {
  const tables = [
    'access_profiles', 'access_policies', 'access_source_links',
    'access_employees', 'access_relationships', 'access_policy_version', 'access_audit',
  ];
  for (const t of tables) {
    if (t === 'access_policy_version') {
      await pool.query(`CREATE TABLE IF NOT EXISTS ${t} (key TEXT PRIMARY KEY DEFAULT 'current', version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT now())`);
    } else if (t === 'access_audit') {
      await pool.query(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), actor JSONB, change JSONB, previous JSONB, next JSONB, policy_version INTEGER)`);
    } else {
      const pk = { access_profiles:'profile_code', access_policies:'policy_id', access_source_links:'link_id', access_employees:'employee_code', access_relationships:'relationship_id' }[t];
      await pool.query(`CREATE TABLE IF NOT EXISTS ${t} (${pk} TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1)`);
    }
  }
  await pool.query(`INSERT INTO access_policy_version (key, version) VALUES ('current', 1) ON CONFLICT DO NOTHING`);
}

async function upsertJson(table, pkCol, records) {
  for (const r of records) {
    const pk = r[{'access_profiles':'profileCode','access_policies':'policyId','access_source_links':'linkId','access_employees':'employeeCode','access_relationships':'relationshipId'}[table]];
    await pool.query(`INSERT INTO ${table} (${pkCol}, data, version) VALUES ($1,$2,$3) ON CONFLICT (${pkCol}) DO UPDATE SET data=$2, version=${table}.version+1`, [pk, JSON.stringify(r), r.version||1]);
  }
}

async function migrateAudit() {
  const lines = readJson('audit.jsonl', ''); // read as raw text
  const raw = fs.readFileSync(new URL('audit.jsonl', `file://${DATA_DIR}/`), 'utf-8').split('\n').filter(Boolean);
  for (const line of raw) {
    const e = JSON.parse(line);
    await pool.query(`INSERT INTO access_audit (id, at, actor, change, previous, next, policy_version) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [e.id, e.at, e.actor ? JSON.stringify(e.actor) : null, e.change ? JSON.stringify(e.change) : null,
       e.previous ? JSON.stringify(e.previous) : null, e.next ? JSON.stringify(e.next) : null, e.policyVersion]);
  }
  return raw.length;
}

async function main() {
  await initSchema();
  const profiles = readJson('profiles.json', []);
  const policies = readJson('policies.json', []);
  const sourceLinks = readJson('source_links.json', []);
  const employees = readJson('employees.json', []);
  const relationships = readJson('relationships.json', []);
  const pv = readJson('policy_version.json', { version: 1 });

  await upsertJson('access_profiles', 'profile_code', profiles);
  await upsertJson('access_policies', 'policy_id', policies);
  await upsertJson('access_source_links', 'link_id', sourceLinks);
  await upsertJson('access_employees', 'employee_code', employees);
  await upsertJson('access_relationships', 'relationship_id', relationships);

  await pool.query(`UPDATE access_policy_version SET version=$1, updated_at=now() WHERE key='current'`, [pv.version]);

  const auditCount = await migrateAudit();

  console.log(`Migrated: ${profiles.length} profiles, ${policies.length} policies, ${sourceLinks.length} links, ${employees.length} employees, ${relationships.length} relationships, pv=${pv.version}, ${auditCount} audit events`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
