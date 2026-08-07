// e2e-role-matrix.mjs — Playwright: ทดสอบ UI ตามสิทธิ์ของแต่ละบทบาท (RBAC Matrix)
// ใช้: BASE=http://localhost:5174 node e2e-role-matrix.mjs (ต้อง backend:5199 + vite dev:5174 รันอยู่)
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5174';
const SHOT_DIR = '/tmp/e2e-shots';
import fs from 'fs';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'th-TH' });
const page = await ctx.newPage();

let failures = 0;
const check = (name, ok, extra) => { console.log((ok ? '✅' : '❌'), name, extra || ''); if (!ok) failures++; };

const ROLES = [
  { name: 'CEO', username: 'ceo', password: 'CEO@Landyi2026', syncVisible: true, rbacProbe: 'เงินเดือนเฉลี่ยของบริษัทเท่าไหร่', rbacExpectedBlock: false, q: 'CEO คือใคร', qExpect: ['ธนกฤต'] },
  { name: 'HR', username: 'hr-manager', password: 'HR@2026test', syncVisible: true, rbacProbe: 'เงินเดือนของพนักงานทุกคนเท่าไหร่', rbacExpectedBlock: false, q: 'แผนก IT มีกี่คน', qExpect: ['IT'] },
  { name: 'Manager', username: 'it-manager', password: 'Exec@2026test', syncVisible: false, rbacProbe: 'เงินเดือนของ CEO เท่าไหร่', rbacExpectedBlock: true, q: 'แผนก IT มีกี่คน', qExpect: ['IT', '4'] },
  { name: 'Employee', username: 'emp144', password: 'Emp@2026test', syncVisible: false, rbacProbe: 'เงินเดือนเฉลี่ยของบริษัทเท่าไหร่', rbacExpectedBlock: true, q: 'EMP144', qExpect: ['EMP144'] },
];

async function login(username, password) {
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  // เคลียร์ session เก่า (แต่ละบทบาทต้อง login ใหม่)
  await page.evaluate(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginForm', { timeout: 30000 });
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', password);
  await page.click('#loginSubmit');
  await page.waitForFunction(() => {
    const ov = document.getElementById('loginOverlay');
    return ov && ov.classList.contains('is-hidden');
  }, { timeout: 90000 });
}

async function askChat(q) {
  await page.waitForSelector('#chatInput', { timeout: 15000 });
  const before = await page.$$eval('#chatMessages .chat-message', (els) => els.length);
  await page.fill('#chatInput', q);
  await page.click('#sendChat');
  // รอให้มีข้อความใหม่เพิ่มจาก before
  await page.waitForFunction(
    (n) => document.querySelectorAll('#chatMessages .chat-message').length > n,
    before,
    { timeout: 30000 },
  );
  // รอจนกว่าข้อความสุดท้ายไม่ใช่ placeholder (Searching/กำลัง…) — คำตอบจริงมาแล้ว
  await page.waitForFunction(() => {
    const els = document.querySelectorAll('#chatMessages .chat-message');
    if (!els.length) return false;
    const t = els[els.length - 1].textContent || '';
    return t.length > 15 && !/Searching|กำลัง|คิดอยู่|\.\.\./.test(t);
  }, null, { timeout: 30000 }).catch(() => {});
  const msgs = await page.$$eval('#chatMessages .chat-message', (els) => els.map((e) => e.textContent));
  return msgs[msgs.length - 1] || '';
}

try {
  for (const role of ROLES) {
    console.log(`\n═══ ทดสอบบทบาท: ${role.name} (${role.username}) ═══`);
    await login(role.username, role.password);

    // 1) user chip แสดงบทบาทถูก
    const chipRole = await page.$eval('.user-chip-role', (e) => e.textContent).catch(() => '');
    check(`${role.name} — userChip role`, chipRole === role.name, `(${chipRole})`);

    // 2) ปุ่ม Sync ตามสิทธิ์ (CEO/HR เห็น, Manager/Employee ซ่อน)
    const topSyncHidden = await page.$eval('#topSyncBtn', (b) => b.classList.contains('is-hidden')).catch(() => true);
    check(`${role.name} — ปุ่ม Sync ${role.syncVisible ? 'เห็น' : 'ซ่อน'}`, topSyncHidden !== role.syncVisible, topSyncHidden ? '(hidden)' : '(visible)');

    // 3) Registry status โหลด
    const hasRows = await page.$('.registry-status-row').then((el) => !!el).catch(() => false);
    check(`${role.name} — Registry status`, hasRows);

    // 4) Chat ใน scope
    const ans = await askChat(role.q);
    const expectOk = role.qExpect.some((s) => ans.includes(s));
    check(`${role.name} — Chat "${role.q.slice(0, 25)}"`, expectOk, ans.slice(0, 100).replace(/\n/g, ' '));

    // 5) RBAC probe (เงินเดือน) — CEO/HR ต้องตอบได้, Manager/Employee ต้องถูก block
    const probeAns = await askChat(role.rbacProbe);
    const isBlocked = /Query blocked|blocked by governance|🚫/.test(probeAns);
    check(`${role.name} — RBAC "${role.rbacProbe.slice(0, 25)}" ${role.rbacExpectedBlock ? 'ต้องถูก block' : 'ต้องตอบได้'}`, isBlocked === role.rbacExpectedBlock, probeAns.slice(0, 80).replace(/\n/g, ' '));

    await page.screenshot({ path: `${SHOT_DIR}/role-${role.name}.png` });
    console.log(`📸 screenshot: ${SHOT_DIR}/role-${role.name}.png`);
  }
} catch (e) {
  console.error('ERROR:', e.message);
  failures++;
  await page.screenshot({ path: SHOT_DIR + '/role-error.png' }).catch(() => {});
}

console.log(failures === 0 ? '\nALL PASS ✅' : `\nFAILURES: ${failures} ❌`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
