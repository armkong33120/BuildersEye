// accessStoreNeon.js — Neon/Postgres adapter for the access model.
// Write-through in-memory cache so sync get*() callers work unchanged.
// Optimistic concurrency: version column — stale writes → { conflict: true }.
import { getPool } from '../neonStore.js';

const cache = { profiles:[], policies:[], sourceLinks:[], employees:[], relationships:[], policyVersion:1 };

// ── Schema DDL (idempotent) ─────────────────────────────────────────────────
export async function initAccessNeonSchema() {
  const pool = getPool();
  const tables = [
    `CREATE TABLE IF NOT EXISTS access_profiles (profile_code TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS access_policies (policy_id TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS access_source_links (link_id TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS access_employees (employee_code TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS access_relationships (relationship_id TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS access_policy_version (key TEXT PRIMARY KEY DEFAULT 'current', version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS access_audit (id TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), actor JSONB, change JSONB, previous JSONB, next JSONB, policy_version INTEGER)`,
  ];
  for (const t of tables) await pool.query(t);
  await pool.query(`INSERT INTO access_policy_version (key, version) VALUES ('current', 1) ON CONFLICT DO NOTHING`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_access_audit_entity ON access_audit ((change->>'entity'))`);
}

// ── Preload cache ───────────────────────────────────────────────────────────
export async function preloadAccessCache() {
  const pool = getPool();
  const r = await Promise.all([
    pool.query('SELECT data FROM access_profiles'),
    pool.query('SELECT data FROM access_policies'),
    pool.query('SELECT data FROM access_source_links'),
    pool.query('SELECT data FROM access_employees'),
    pool.query('SELECT data FROM access_relationships'),
    pool.query("SELECT version FROM access_policy_version WHERE key='current'"),
  ]);
  cache.profiles = r[0].rows.map(x => x.data);
  cache.policies = r[1].rows.map(x => x.data);
  cache.sourceLinks = r[2].rows.map(x => x.data);
  cache.employees = r[3].rows.map(x => x.data);
  cache.relationships = r[4].rows.map(x => x.data);
  cache.policyVersion = r[5].rows[0]?.version ?? 1;
}

// ── Optimistic upsert ───────────────────────────────────────────────────────
async function upsertRow(table, pkCol, pkVal, data, expectedVersion) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (expectedVersion != null) {
      const cur = await client.query(`SELECT version FROM ${table} WHERE ${pkCol}=$1`, [pkVal]);
      if (cur.rows.length > 0 && cur.rows[0].version !== expectedVersion) {
        await client.query('ROLLBACK');
        return { conflict: true, currentVersion: cur.rows[0].version };
      }
    }
    await client.query(`INSERT INTO ${table} (${pkCol}, data, version) VALUES ($1,$2,1) ON CONFLICT (${pkCol}) DO UPDATE SET data=$2, version=${table}.version+1`, [pkVal, JSON.stringify(data)]);
    await client.query('COMMIT');
    return { conflict: false };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── Write helpers ───────────────────────────────────────────────────────────
export async function saveProfilesNeon(list) { for (const x of list) await upsertRow('access_profiles','profile_code',x.profileCode,x,x.version); cache.profiles=list; }
export async function savePoliciesNeon(list) { for (const x of list) await upsertRow('access_policies','policy_id',x.policyId,x,x.version); cache.policies=list; }
export async function saveSourceLinksNeon(list) { for (const x of list) await upsertRow('access_source_links','link_id',x.linkId,x,x.version); cache.sourceLinks=list; }
export async function saveEmployeesNeon(list) { for (const x of list) await upsertRow('access_employees','employee_code',x.employeeCode,x,x.version); cache.employees=list; }
export async function saveRelationshipsNeon(list) { for (const x of list) await upsertRow('access_relationships','relationship_id',x.relationshipId,x,x.version); cache.relationships=list; }
export async function bumpPolicyVersionNeon() { const r = await getPool().query("UPDATE access_policy_version SET version=version+1, updated_at=now() WHERE key='current' RETURNING version"); const v = r.rows[0].version; cache.policyVersion=v; return v; }

// ── Read helpers (sync, from cache) ─────────────────────────────────────────
export function getProfilesNeon()  { return cache.profiles; }
export function getPoliciesNeon()  { return cache.policies; }
export function getSourceLinksNeon() { return cache.sourceLinks; }
export function getEmployeesNeon() { return cache.employees; }
export function getRelationshipsNeon() { return cache.relationships; }
export function getPolicyVersionNeon() { return cache.policyVersion; }

// ── Seed ────────────────────────────────────────────────────────────────────
export async function seedAccessModelNeon() { await preloadAccessCache(); if (!cache.profiles.length) { const { SEED_PROFILES, SEED_POLICIES } = await import('./accessModel.js'); for (const p of SEED_PROFILES) await upsertRow('access_profiles','profile_code',p.profileCode,{...p},null); for (const p of SEED_POLICIES) await upsertRow('access_policies','policy_id',p.policyId,{...p},null); await preloadAccessCache(); } return { profiles:cache.profiles.length, policies:cache.policies.length, employees:cache.employees.length }; }

// ── Audit ───────────────────────────────────────────────────────────────────
export async function recordAuditNeon(event) {
  await getPool().query(`INSERT INTO access_audit (id,at,actor,change,previous,next,policy_version) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [event.id, event.at, JSON.stringify(event.actor), JSON.stringify(event.change), event.previous?JSON.stringify(event.previous):null, event.next?JSON.stringify(event.next):null, event.policyVersion]);
  return event;
}
export async function listAuditNeon({limit=100,entity=null}={}) {
  const pool=getPool(); let q='SELECT * FROM access_audit'; const p=[];
  if(entity){q+=" WHERE change->>'entity'=$1"; p.push(entity);}
  q+=` ORDER BY at DESC LIMIT $${p.length+1}`; p.push(limit);
  const r=await pool.query(q,p);
  return r.rows.map(r=>({id:r.id,at:r.at,actor:r.actor,change:r.change,previous:r.previous,next:r.next,policyVersion:r.policy_version}));
}
export async function findPreviousSnapshotNeon(entity,entityId) {
  const r=await getPool().query(`SELECT previous FROM access_audit WHERE change->>'entity'=$1 AND change->>'entityId'=$2 AND previous IS NOT NULL ORDER BY at DESC LIMIT 1`,[entity,entityId]);
  return r.rows[0]?.previous??null;
}
