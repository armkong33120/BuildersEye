// authStore.js — JWT auth + user store (M1). File-based (Render free tier), seeds from identity-graph.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '.data', 'auth');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const JWT_SECRET = process.env.JWT_SECRET || 'builderseye-dev-secret-change-in-prod';
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

// default password per role (demo/test). In prod these are forced-change on first login.
function defaultPassword(role) {
  if (role === 'CEO') return 'CEO@Landyi2026';
  if (role === 'HR') return 'HR@2026test';
  if (role === 'Manager') return 'Exec@2026test';
  return 'Emp@2026test';
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
  const identities = identityGraph?.identities || [];
  const users = identities.map((idn) => {
    const role = roleForIdentity(idn);
    const username = usernameFor(idn);
    return {
      id: idn.pk,
      employeeId: idn.pk,
      username,
      passwordHash: bcrypt.hashSync(defaultPassword(role), 10),
      role,
      dept: idn.department || '',
      name: idn.name || username,
      jobTitle: idn.jobTitle || '',
      isActive: true,
      mustChangePassword: false, // demo: allow default passwords; set true to force change
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
function loadSessions() { return readJson(SESSIONS_FILE, { sessions: [] }).sessions; }
function saveSessions(sessions) { writeJson(SESSIONS_FILE, { sessions }); }

function publicUser(u) {
  return { id: u.id, employeeId: u.employeeId, username: u.username, role: u.role, dept: u.dept, name: u.name, jobTitle: u.jobTitle, mustChangePassword: !!u.mustChangePassword };
}

function issueTokens(user) {
  const accessToken = jwt.sign(
    { sub: user.id, username: user.username, role: user.role, employeeId: user.employeeId, name: user.name },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const sessions = loadSessions();
  sessions.push({
    id: crypto.randomBytes(12).toString('hex'),
    userId: user.id,
    tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
    revoked: false,
  });
  saveSessions(sessions);
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

export function login(username, password, ip) {
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
  const tokens = issueTokens(user);
  return { ...tokens, user: publicUser(user) };
}

export function refresh(refreshToken) {
  if (!refreshToken) { const e = new Error('Missing refresh token'); e.status = 400; throw e; }
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const sessions = loadSessions();
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
  const tokens = issueTokens(user);
  saveSessions(sessions);
  return { ...tokens, user: publicUser(user) };
}

export function logout(refreshToken) {
  if (!refreshToken) return { success: true };
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const sessions = loadSessions();
  const idx = sessions.findIndex((s) => s.tokenHash === hash);
  if (idx !== -1) { sessions[idx].revoked = true; saveSessions(sessions); }
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
export function previewCredentials() {
  if (process.env.ENABLE_TEST_CREDS !== 'true') return null;
  return listUsers().map((u) => ({
    username: u.username,
    password: defaultPassword(u.role),
    role: u.role,
    name: u.name,
    jobTitle: u.jobTitle,
  }));
}