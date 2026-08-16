// accessStore.js — File-backed persistence for the normalized access model.
//
// Local dev uses JSON files under server/.data/access/. When DATABASE_URL is
// set, a Neon write-through can be added later (see neonSync.js) without
// changing this module's public API.
//
// Persistence safety (Phase P2):
//   - Every JSON mutation is written ATOMICALLY: the new content goes to a
//     unique temp file (`<file>.tmp-<pid>`) in the same directory, then
//     fs.renameSync() replaces the target. rename is atomic on the same
//     filesystem, so a crash can never leave a torn/truncated store file —
//     readers see either the complete old file or the complete new file.
//   - Mutation helpers (saveProfiles/savePolicies/saveSourceLinks/saveEmployees/
//     saveRelationships/bumpPolicyVersion) are serialized by an ADVISORY write
//     lock (withAccessWriteLock) using atomic mkdir on a lock directory. The
//     lock serializes writers that share the same data dir / filesystem; it is
//     NOT a cross-host lock (multi-instance persistence on separate hosts
//     remains BLOCKED — see docs/PERSISTENCE.md).
//   - Stale temp files left by a crash mid-rename are cleaned on startup.
//
// Layout:
//   profiles.json     — access profiles (seeded)
//   policies.json     — permission policies (seeded)
//   source_links.json — data source links
//   employees.json    — normalized employee records (accessProfile pointer)
//   relationships.json— organization relationships (temporal edges)
//
// All mutations go through adminService.js (which records audit events), NOT
// through this module directly.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SEED_PROFILES,
  SEED_POLICIES,
  employeeKey,
} from './accessModel.js';
import { profileForLegacyRole } from './compatAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ACCESS_DATA_DIR || path.join(__dirname, '..', '.data', 'access');

const FILES = {
  profiles: 'profiles.json',
  policies: 'policies.json',
  sourceLinks: 'source_links.json',
  employees: 'employees.json',
  relationships: 'relationships.json',
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Advisory write lock ───────────────────────────────────────────────────────
// Serializes JSON mutations that share this data dir using an atomic mkdir as
// the lock primitive (mkdir succeeds for exactly one holder). The lock is
// ADVISORY and filesystem-local: it coordinates writers on the same host / same
// filesystem only. Separate hosts have NO cross-host lock — multi-instance
// persistence remains BLOCKED (see docs/PERSISTENCE.md).
const LOCK_DIR = path.join(DATA_DIR, '.lock');
const LOCK_TIMEOUT_MS = 5000;  // give up after ~5s of contention
const LOCK_RETRY_MS = 50;      // poll interval while waiting
const LOCK_STALE_MS = 10000;   // break a lock this old (holder crashed)

let lockHeldInProcess = false;

// Synchronous sleep (Atomics.wait is allowed on the main thread in Node).
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireWriteLock() {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // A lock exists. Break it only if it is stale (previous holder crashed).
      try {
        const st = fs.statSync(LOCK_DIR);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(LOCK_DIR, { recursive: true, force: true });
          continue;
        }
      } catch { /* stat raced (lock just released) — retry the mkdir */ }
      if (Date.now() >= deadline) {
        const e = new Error('Timed out waiting for the access write lock');
        e.code = 'ELOCKTIMEOUT';
        throw e;
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

// Run `fn` while holding the advisory access write lock (released on finally).
// Reentrant within this process: a helper already holding the lock may call
// another locked helper without deadlocking (Node is single-threaded, so the
// only way to nest is an explicit call chain).
export function withAccessWriteLock(fn) {
  if (lockHeldInProcess) return fn();
  acquireWriteLock();
  lockHeldInProcess = true;
  try {
    return fn();
  } finally {
    lockHeldInProcess = false;
    try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// Remove stale `<file>.tmp-<pid>` files left by a crash mid-rename. Ignore any
// failure (best-effort startup hygiene; a leftover tmp file is never read).
function cleanupStaleTmpFiles() {
  try {
    for (const entry of fs.readdirSync(DATA_DIR)) {
      if (/\.tmp-\d+$/.test(entry)) {
        try { fs.unlinkSync(path.join(DATA_DIR, entry)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}
cleanupStaleTmpFiles();

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf-8'));
  } catch {
    return fallback;
  }
}

// Atomic write: serialize to a unique temp file in the SAME directory, then
// fs.renameSync() over the target. rename is atomic on the same filesystem
// (POSIX; same-volume on Windows), so a crash mid-write can never leave a torn
// store file — a concurrent reader sees either the complete old or the complete
// new content. Stale tmp files from a crash are cleaned on startup.
function writeJson(name, obj) {
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

// ── Profiles ─────────────────────────────────────────────────────────────────
export function getProfiles() {
  return readJson(FILES.profiles, []);
}

export function getProfilesMap() {
  const map = new Map();
  for (const p of getProfiles()) map.set(p.profileCode, p);
  return map;
}

export function getProfile(code) {
  return getProfiles().find((p) => p.profileCode === code) || null;
}

export function saveProfiles(profiles) {
  return withAccessWriteLock(() => writeJson(FILES.profiles, profiles));
}

// ── Policies ─────────────────────────────────────────────────────────────────
export function getPolicies() {
  return readJson(FILES.policies, []);
}

export function savePolicies(policies) {
  return withAccessWriteLock(() => writeJson(FILES.policies, policies));
}

// ── Source links ─────────────────────────────────────────────────────────────
export function getSourceLinks() {
  return readJson(FILES.sourceLinks, []);
}

export function saveSourceLinks(links) {
  return withAccessWriteLock(() => writeJson(FILES.sourceLinks, links));
}

// ── Employees (normalized) ───────────────────────────────────────────────────
export function getEmployees() {
  return readJson(FILES.employees, []);
}

export function saveEmployees(employees) {
  return withAccessWriteLock(() => writeJson(FILES.employees, employees));
}

export function getEmployeeByCode(code) {
  const key = employeeKey(code);
  return getEmployees().find((e) => employeeKey(e.employeeCode) === key) || null;
}

// ── Relationships ────────────────────────────────────────────────────────────
export function getRelationships() {
  return readJson(FILES.relationships, []);
}

export function saveRelationships(relationships) {
  return withAccessWriteLock(() => writeJson(FILES.relationships, relationships));
}

// ── Policy version (for cache keys) ──────────────────────────────────────────
export function getPolicyVersion() {
  return readJson('policy_version.json', { version: 1 }).version;
}

export function bumpPolicyVersion() {
  // The read-modify-write of policy_version.json runs INSIDE the advisory lock
  // so concurrent bumps serialize instead of both reading the same version.
  return withAccessWriteLock(() => {
    const cur = getPolicyVersion();
    writeJson('policy_version.json', { version: cur + 1, updatedAt: new Date().toISOString() });
    return cur + 1;
  });
}

export function getDataDir() { return DATA_DIR; }


// ── Seeding ──────────────────────────────────────────────────────────────────
// Idempotent: seeds profiles + policies once, then derives normalized employee
// records from a legacy identity graph (or registry employees) by mapping the
// legacy role → access profile code. Never overwrites existing admin edits.
export function seedAccessModel({ identityGraph, employees } = {}) {
  let profiles = getProfiles();
  if (!profiles.length) {
    profiles = SEED_PROFILES.map((p) => ({ ...p }));
    saveProfiles(profiles);
  }

  let policies = getPolicies();
  if (!policies.length) {
    policies = SEED_POLICIES.map((p) => ({ ...p }));
    savePolicies(policies);
  }

  const identities = identityGraph?.identities || employees || [];
  if (identities.length) {
    const existing = getEmployees();
    const existingByCode = new Map(existing.map((e) => [employeeKey(e.employeeCode), e]));
    const normalized = identities
      .filter((i) => i && (i.code || i.employeeCode))
      .map((i) => {
        const code = employeeKey(i.code ?? i.employeeCode);
        const legacyRole = deriveLegacyRoleFromIdentity(i);
        const profileCode = existingByCode.get(code)?.accessProfile
          || profileForLegacyRole(legacyRole);
        return {
          employeeCode: code,
          employeeId: i.pk ?? i.employeeId ?? null,
          name: i.name ?? '',
          department: i.department ?? '',
          jobTitle: i.jobTitle ?? '',
          managerCode: i.managerCode ?? '',
          status: i.status ?? 'active',
          accessProfile: profileCode,
          version: existingByCode.get(code)?.version ?? 1,
        };
      });
    saveEmployees(normalized);
  }

  return { profiles: profiles.length, policies: policies.length, employees: getEmployees().length };
}

// Derive a legacy role from an identity (mirrors authStore.roleForIdentity but
// with the HR-by-department bug fixed: 'HR & Admin', not 'HR / Admin').
function deriveLegacyRoleFromIdentity(identity) {
  const jt = (identity.jobTitle || '').toLowerCase();
  const dept = identity.department || '';
  if (identity.roleGroup === 'CEO' || identity.hierarchyDepth === 0) return 'CEO';
  if (dept === 'HR & Admin' || dept === 'HR / Admin' || jt.includes('hr ') || jt.includes('human resources') || jt.includes('recruiter')) return 'HR';
  if (jt.includes('chief') || jt.includes('manager') || jt.includes('director') || jt.includes('secretary') || jt.includes('head of')) return 'Manager';
  return 'Employee';
}
