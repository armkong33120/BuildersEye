// accessStore.js — File-backed persistence for the normalized access model.
//
// Local dev uses JSON files under server/.data/access/. When DATABASE_URL is
// set, a Neon write-through can be added later (see neonSync.js) without
// changing this module's public API.
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

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, obj) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(obj, null, 2), 'utf-8');
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
  writeJson(FILES.profiles, profiles);
}

// ── Policies ─────────────────────────────────────────────────────────────────
export function getPolicies() {
  return readJson(FILES.policies, []);
}

export function savePolicies(policies) {
  writeJson(FILES.policies, policies);
}

// ── Source links ─────────────────────────────────────────────────────────────
export function getSourceLinks() {
  return readJson(FILES.sourceLinks, []);
}

export function saveSourceLinks(links) {
  writeJson(FILES.sourceLinks, links);
}

// ── Employees (normalized) ───────────────────────────────────────────────────
export function getEmployees() {
  return readJson(FILES.employees, []);
}

export function saveEmployees(employees) {
  writeJson(FILES.employees, employees);
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
  writeJson(FILES.relationships, relationships);
}

// ── Policy version (for cache keys) ──────────────────────────────────────────
export function getPolicyVersion() {
  return readJson('policy_version.json', { version: 1 }).version;
}

export function bumpPolicyVersion() {
  const cur = getPolicyVersion();
  writeJson('policy_version.json', { version: cur + 1, updatedAt: new Date().toISOString() });
  return cur + 1;
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
