// authStore.js — JWT auth + user store (M1). File-based (local dev) + Neon Postgres (prod: durable sessions), seeds from identity-graph.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { isNeonEnabled, getPool } from './neonStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '.data', 'auth');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // SECURITY: never fall back to a hardcoded secret. Require JWT_SECRET in production.
  console.error('[SECURITY] JWT_SECRET environment variable is REQUIRED. Refusing to start.');
  process.exit(1);
}
const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || '30m';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --- Role assignment from identity (M6 mapping) ---
function roleForIdentity(identity) {
  const jt = (identity.jobTitle || '').toLowerCase();
  const dept = identity.department || '';
  if (identity.roleGroup === 'CEO' || identity.hierarchyDepth === 0) return 'CEO';
  if (dept === 'HR / Admin' || jt.includes('hr ') || jt.includes('human resources') || jt.includes('recruiter')) return 'HR';
  // Manager = leadership titles only (C-Level, dept Managers, secretaries, heads).
  // IT Support / officers / staff are Employee even if they sit at depth 2.
  if (jt.includes('chief') || jt.includes('manager') || jt.includes('director') || jt.includes('secretary') || jt.includes('head of')) return 'Manager';
  return 'Employee';
}

function usernameFor(identity) {
  const code = (identity.code || ('EMP' + identity.pk)).toLowerCase();
  const jt = (identity.jobTitle || '').toLowerCase();
  if (identity.roleGroup === 'CEO') return 'ceo';
  if (jt.includes('chief operations')) return 'coo';
  if (jt.includes('chief financial')) return 'cfo';
  if (jt.includes('chief marketing')) return 'cmo';
  if (jt.includes('it manager')) return 'it-manager';
  if (jt.includes('human resources manager') || jt === 'hr manager') return 'hr-manager';
  return code; // emp001 ...
}

// SECURITY: generate a strong random initial password per user instead of a
// hardcoded default. Users MUST change it on first login (mustChangePassword=true).
function randomInitialPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf-8');
}

// --- Seed users from identity-graph (idempotent) ---
export function seedUsers(identityGraph) {
  const existing = readJson(USERS_FILE, null);
  if (existing && Array.isArray(existing.users) && existing.users.length > 0) {
    return existing.users.length;
  }
  // TEST MODE (ENABLE_TEST_CREDS=true + TEST_ACCOUNT_PASSWORD set): seed a KNOWN password for all
  // accounts so demo/test users can actually log in on staging/prod (M4 "Test Accounts Panel").
  // Otherwise passwords stay random (secure default — nobody knows them, mustChangePassword=true).
  // SECURITY: production with ENABLE_TEST_CREDS=true is a MAJOR risk — log a loud warning.
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const testMode = process.env.ENABLE_TEST_CREDS === 'true';
  const testPassword = process.env.TEST_ACCOUNT_PASSWORD || '';
  const useKnownPassword = testMode && testPassword.length >= 8;

  if (testMode && nodeEnv === 'production') {
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║  [SECURITY] ENABLE_TEST_CREDS=true in PRODUCTION!          ║');
    console.error('║  All 150 users share the same known password.              ║');
    console.error('║  This is intended ONLY for demo/staging environments.      ║');
    console.error('║  Set ENABLE_TEST_CREDS=false for real production use.      ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
  }

  if (testMode && !useKnownPassword) {
    console.warn('[auth] ENABLE_TEST_CREDS=true but TEST_ACCOUNT_PASSWORD is missing/short (<8) — falling back to random passwords');
  }
  const identities = identityGraph?.identities || [];
  const users = identities.map((idn) => {
    const role = roleForIdentity(idn);
    const username = usernameFor(idn);
    return {
      id: idn.pk,
      employeeId: idn.pk,
      username,
      passwordHash: bcrypt.hashSync(useKnownPassword ? testPassword : randomInitialPassword(), 10),
      role,
      isAdmin: role === 'CEO', // CEO is the system admin
      dept: idn.department || '',
      name: idn.name || username,
      jobTitle: idn.jobTitle || '',
      isActive: true,
      mustChangePassword: useKnownPassword ? false : true, // test mode: ไม่บังคับเปลี่ยนรหัส
      createdAt: new Date().toISOString(),
    };
  });
  writeJson(USERS_FILE, { users });
  return users.length;
}

export function listUsers() {
  return readJson(USERS_FILE, { users: [] }).users;
}

function findUser(username) {
  const un = String(username || '').toLowerCase().trim();
  return listUsers().find((u) => u.username === un) || null;
}

// --- Sessions (refresh tokens) ---
// Local: file-based (sessions.json). Production (DATABASE_URL set): Neon Postgres — sessions survive
// container cold-starts / scale-to-zero so users don't get logged out ("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่").
let _authSessionsReady = false;
async function ensureAuthSessionsTable() {
  if (_authSessionsReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      revoked BOOLEAN NOT NULL DEFAULT false
    )`);
  await getPool().query('CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions (token_hash)');
  _authSessionsReady = true;
}
function sessionRowToObj(r) {
  return { id: r.id, userId: r.user_id, tokenHash: r.token_hash, createdAt: r.created_at, expiresAt: r.expires_at, revoked: r.revoked };
}
async function neonLoadSessions() {
  await ensureAuthSessionsTable();
  const { rows } = await getPool().query('SELECT id, user_id, token_hash, created_at, expires_at, revoked FROM auth_sessions');
  return rows.map(sessionRowToObj);
}
async function neonSaveSessions(sessions) {
  await ensureAuthSessionsTable();
  const pool = getPool();
  await pool.query('DELETE FROM auth_sessions');
  for (const s of sessions) {
    await pool.query(
      'INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, revoked) VALUES ($1,$2,$3,$4,$5,$6)',
      [s.id, s.userId, s.tokenHash, s.createdAt, s.expiresAt, !!s.revoked]
    );
  }
}
function loadSessions() { return readJson(SESSIONS_FILE, { sessions: [] }).sessions; }
function saveSessions(sessions) { writeJson(SESSIONS_FILE, { sessions }); }
async function loadSessionsDurable() {
  if (isNeonEnabled()) return neonLoadSessions();
  return loadSessions();
}
async function saveSessionsDurable(sessions) {
  if (isNeonEnabled()) return neonSaveSessions(sessions);
  saveSessions(sessions);
}

function publicUser(u) {
  return { id: u.id, employeeId: u.employeeId, username: u.username, role: u.role, isAdmin: !!u.isAdmin, dept: u.dept, name: u.name, jobTitle: u.jobTitle, mustChangePassword: !!u.mustChangePassword };
}

async function issueTokens(user) {
  const accessToken = jwt.sign(
    { sub: user.id, username: user.username, role: user.role, employeeId: user.employeeId, name: user.name },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const sessions = await loadSessionsDurable();
  sessions.push({
    id: crypto.randomBytes(12).toString('hex'),
    userId: user.id,
    tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
    revoked: false,
  });
  await saveSessionsDurable(sessions);
  return { accessToken, refreshToken };
}

// --- Login rate limiting (5/min per username+IP) ---
const attempts = new Map();
function checkRateLimit(key) {
  const now = Date.now();
  const arr = (attempts.get(key) || []).filter((t) => now - t < 60 * 1000);
  attempts.set(key, arr);
  if (arr.length >= 5) return false;
  arr.push(now);
  attempts.set(key, arr);
  return true;
}

export async function login(username, password, ip) {
  const key = String(username || '').toLowerCase() + '|' + (ip || '');
  if (!checkRateLimit(key)) {
    const e = new Error('Too many login attempts. Try again in a minute.');
    e.status = 429; throw e;
  }
  const user = findUser(username);
  if (!user || !user.isActive) {
    const e = new Error('Invalid username or password'); e.status = 401; throw e;
  }
  if (!bcrypt.compareSync(String(password || ''), user.passwordHash)) {
    const e = new Error('Invalid username or password'); e.status = 401; throw e;
  }
  const tokens = await issueTokens(user);
  return { ...tokens, user: publicUser(user) };
}

export async function refresh(refreshToken) {
  if (!refreshToken) { const e = new Error('Missing refresh token'); e.status = 400; throw e; }
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const sessions = await loadSessionsDurable();
  const idx = sessions.findIndex((s) => s.tokenHash === hash && !s.revoked);
  if (idx === -1) { const e = new Error('Invalid refresh token'); e.status = 401; throw e; }
  const sess = sessions[idx];
  if (new Date(sess.expiresAt).getTime() < Date.now()) {
    const e = new Error('Refresh token expired'); e.status = 401; throw e;
  }
  // rotate
  sessions[idx].revoked = true;
  const user = listUsers().find((u) => u.id === sess.userId);
  if (!user) { const e = new Error('User not found'); e.status = 401; throw e; }
  const tokens = await issueTokens(user);
  await saveSessionsDurable(sessions);
  return { ...tokens, user: publicUser(user) };
}

export async function logout(refreshToken) {
  if (!refreshToken) return { success: true };
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const sessions = await loadSessionsDurable();
  const idx = sessions.findIndex((s) => s.tokenHash === hash);
  if (idx !== -1) { sessions[idx].revoked = true; await saveSessionsDurable(sessions); }
  return { success: true };
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = listUsers().find((u) => u.id === payload.sub);
    if (!user || !user.isActive) return null;
    return publicUser(user);
  } catch { return null; }
}

// --- Preview credentials (M4, only when enabled) ---
// SECURITY: never reveal real passwords. Returns role/identity info only.
export function previewCredentials() {
  if (process.env.ENABLE_TEST_CREDS !== 'true') return null;
  return listUsers().map((u) => ({
    username: u.username,
    role: u.role,
    name: u.name,
    jobTitle: u.jobTitle,
  }));
}

// --- Online users (currently logged in / active sessions) ---
export async function listOnlineUsers() {
  const now = Date.now();
  const sessions = await loadSessionsDurable();
  const users = listUsers();
  const active = new Map(); // userId -> { username, name, role, lastActive }
  for (const s of sessions) {
    if (s.revoked) continue;
    if (new Date(s.expiresAt).getTime() < now) continue;
    const u = users.find((x) => x.id === s.userId);
    if (!u) continue;
    const prev = active.get(u.id);
    const last = new Date(s.expiresAt).getTime();
    if (!prev || last > prev.lastActive) {
      active.set(u.id, { username: u.username, name: u.name, role: u.role, dept: u.dept, lastActive: s.expiresAt });
    }
  }
  return [...active.values()].sort((a, b) => a.username.localeCompare(b.username));
}
