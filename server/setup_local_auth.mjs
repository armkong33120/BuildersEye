// setup_local_auth.mjs — สร้าง users.json สำหรับ local dev (เหมือน seedUsers ใน authStore.js)
// แต่ override ให้ user "ceo" มีรหัสผ่านที่รู้ค่า ([TEST_ACCOUNT_PASSWORD]) + mustChangePassword=false
// เพื่อให้ทดสอบ Login → Chat → Debug ครบวงจรได้ด้วย Playwright
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '.data', 'auth');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GRAPH_PATH = path.join(__dirname, '..', 'src', 'data', 'identity-graph.json');

const CEO_PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || '[REDACTED]';

function roleForIdentity(identity) {
  const jt = (identity.jobTitle || '').toLowerCase();
  const dept = identity.department || '';
  if (identity.roleGroup === 'CEO' || identity.hierarchyDepth === 0) return 'CEO';
  if (dept === 'HR & Admin' || dept === 'HR / Admin' || jt.includes('hr ') || jt.includes('human resources') || jt.includes('recruiter')) return 'HR';
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
  return code;
}

function randomInitialPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

const raw = fs.readFileSync(GRAPH_PATH, 'utf-8');
const identityGraph = JSON.parse(raw);
const identities = identityGraph?.identities || [];

const users = identities.map((idn) => {
  const role = roleForIdentity(idn);
  const username = usernameFor(idn);
  const isCEO = username === 'ceo';
  return {
    id: idn.pk,
    employeeId: idn.pk,
    username,
    passwordHash: bcrypt.hashSync(isCEO ? CEO_PASSWORD : randomInitialPassword(), 10),
    role,
    dept: idn.department || '',
    name: idn.name || username,
    jobTitle: idn.jobTitle || '',
    isActive: true,
    mustChangePassword: !isCEO,
    createdAt: new Date().toISOString(),
  };
});

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf-8');

const ceo = users.find((u) => u.username === 'ceo');
const hr = users.find((u) => u.role === 'HR');
console.log(`✅ Created ${users.length} users at ${USERS_FILE}`);
console.log(`   CEO: username=ceo, role=${ceo?.role}, mustChangePassword=${ceo?.mustChangePassword}`);
console.log(`   CEO password = ${CEO_PASSWORD}`);
console.log(`   HR sample: username=${hr?.username}, role=${hr?.role}`);