// rollback-neon-access-to-json.mjs — Read Neon access tables, write JSON files.
// Usage: ACCESS_DB_ADAPTER=neon node scripts/rollback-neon-access-to-json.mjs
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000 });

const DATA_DIR = process.env.ACCESS_DATA_DIR || new URL('../server/.data/access', import.meta.url).pathname;
const fs = (await import('fs')).default;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

async function dump(table, filename, pkMap) {
  const r = await pool.query(`SELECT data FROM ${table}`);
  const records = r.rows.map(x => x.data);
  fs.writeFileSync(new URL(filename, `file://${DATA_DIR}/`), JSON.stringify(records, null, 2), 'utf-8');
  return records.length;
}

async function dumpAudit() {
  const r = await pool.query('SELECT * FROM access_audit ORDER BY at ASC');
  const lines = r.rows.map(x => {
    const ev = { id: x.id, at: x.at, actor: x.actor, change: x.change, previous: x.previous, next: x.next, policyVersion: x.policy_version };
    return JSON.stringify(ev);
  });
  fs.writeFileSync(new URL('audit.jsonl', `file://${DATA_DIR}/`), lines.join('\n') + '\n', 'utf-8');
  return lines.length;
}

async function main() {
  const counts = {
    profiles: await dump('access_profiles', 'profiles.json'),
    policies: await dump('access_policies', 'policies.json'),
    sourceLinks: await dump('access_source_links', 'source_links.json'),
    employees: await dump('access_employees', 'employees.json'),
    relationships: await dump('access_relationships', 'relationships.json'),
  };
  const pv = await pool.query("SELECT version FROM access_policy_version WHERE key='current'");
  const version = pv.rows[0]?.version ?? 1;
  fs.writeFileSync(new URL('policy_version.json', `file://${DATA_DIR}/`), JSON.stringify({ version, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');

  const auditCount = await dumpAudit();

  console.log(`Rolled back to JSON: ${counts.profiles} profiles, ${counts.policies} policies, ${counts.sourceLinks} links, ${counts.employees} employees, ${counts.relationships} relationships, pv=${version}, ${auditCount} audit events`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
