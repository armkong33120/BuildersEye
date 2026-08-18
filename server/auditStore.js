import { getPool, isNeonEnabled } from './neonStore.js';
import fs from 'fs';
import path from 'path';

// Fallback local file if Neon is disabled
const LOCAL_AUDIT_LOG = path.join(process.cwd(), 'server', '.data', 'audit_logs.json');

async function initAuditTable() {
  if (!isNeonEnabled()) return;
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        username VARCHAR(255) NOT NULL,
        role VARCHAR(255) NOT NULL,
        query TEXT NOT NULL,
        status VARCHAR(50) NOT NULL,
        answer_length INT NOT NULL,
        route VARCHAR(50),
        ip VARCHAR(255)
      );
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_username ON audit_logs(username);
    `);
  } catch (err) {
    console.error('[audit] failed to initialize audit_logs table:', err.message);
  }
}

// Call init on load
initAuditTable().catch(() => {});

/**
 * Logs an AI interaction query.
 * @param {object} params - { username, role, query, status, answerLength, route, ip }
 */
export async function logAuditActivity({ username, role, query, status, answerLength, route, ip }) {
  if (isNeonEnabled()) {
    try {
      const pool = getPool();
      if (pool) {
        await pool.query(
          `INSERT INTO audit_logs (username, role, query, status, answer_length, route, ip) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [username || 'unknown', role || 'unknown', query || '', status || 'Unknown', answerLength || 0, route || 'unknown', ip || '0.0.0.0']
        );
        return;
      }
    } catch (e) {
      console.error('[audit] Failed to write to DB:', e.message);
    }
  }

  // Fallback to local JSON array
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      username, role, query, status, answer_length: answerLength, route, ip
    };
    let logs = [];
    if (fs.existsSync(LOCAL_AUDIT_LOG)) {
      logs = JSON.parse(fs.readFileSync(LOCAL_AUDIT_LOG, 'utf8'));
    }
    logs.unshift(entry); // add to top
    if (logs.length > 500) logs = logs.slice(0, 500); // keep last 500
    fs.mkdirSync(path.dirname(LOCAL_AUDIT_LOG), { recursive: true });
    fs.writeFileSync(LOCAL_AUDIT_LOG, JSON.stringify(logs, null, 2), 'utf8');
  } catch (e) {
    console.error('[audit] Failed to write local log:', e.message);
  }
}

/**
 * Retrieves the latest 100 audit logs (Restricted to CEO/Admin upstream)
 */
export async function getAuditLogs() {
  if (isNeonEnabled()) {
    try {
      const pool = getPool();
      if (pool) {
        const { rows } = await pool.query(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100`);
        return rows;
      }
    } catch (e) {
      console.error('[audit] Failed to read from DB:', e.message);
    }
  }

  try {
    if (fs.existsSync(LOCAL_AUDIT_LOG)) {
      return JSON.parse(fs.readFileSync(LOCAL_AUDIT_LOG, 'utf8')).slice(0, 100);
    }
  } catch (e) {
    console.error('[audit] Failed to read local log:', e.message);
  }
  return [];
}
