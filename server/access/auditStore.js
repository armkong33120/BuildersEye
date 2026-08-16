// auditStore.js — Audit + version history for access configuration changes.
//
// Every config change (profile/policy/source-link/employee-profile assignment)
// records an immutable audit event capturing:
//   who (actor), what (entity + action), when (timestamp),
//   previous (snapshot), new (snapshot), policyVersion, and rollback info.
//
// Old permission versions are retained so they are auditable and restorable.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { getPolicyVersion } from './accessStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ACCESS_DATA_DIR || path.join(__dirname, '..', '.data', 'access');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readAudit() {
  try {
    const lines = fs.readFileSync(AUDIT_FILE, 'utf-8').split('\n').filter(Boolean);
    return lines.map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// Record an audit event. `actor` is { username, employeeId, role } from the JWT
// (never from the request body). `change` is { entity, action, entityId }.
// `previous`/`next` are the before/after snapshots (for rollback).
export function recordAudit(actor, change, { previous = null, next = null, policyVersion = null } = {}) {
  const event = {
    id: crypto.randomBytes(12).toString('hex'),
    at: new Date().toISOString(),
    actor: {
      username: actor?.username || null,
      employeeId: actor?.employeeId ?? null,
      role: actor?.role || null,
    },
    change,
    previous,
    next,
    policyVersion: policyVersion ?? getPolicyVersion(),
  };
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(event) + '\n');
  return event;
}

export function listAudit({ limit = 100, entity = null } = {}) {
  let events = readAudit();
  if (entity) events = events.filter((e) => e.change?.entity === entity);
  return events.slice(-limit).reverse();
}

// Find the most recent snapshot of an entity (for rollback).
export function findPreviousSnapshot(entity, entityId, beforeEventId = null) {
  const events = readAudit();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (beforeEventId && e.id === beforeEventId) break;
    if (e.change?.entity === entity && e.change?.entityId === entityId && e.previous != null) {
      return e.previous;
    }
  }
  return null;
}

export function getAuditFile() { return AUDIT_FILE; }
