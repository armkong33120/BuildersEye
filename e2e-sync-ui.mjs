// e2e-sync-ui.mjs — ทดสอบ Registry & Sync UI (local) ใช้: node e2e-sync-ui.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5174';
const SHOT_DIR = '/tmp/e2e-shots';
import fs from 'fs';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'th-TH' });
const page = await ctx.newPage();
const log = (m) => console.log('•', m);
let failures = 0;
const check = (name, ok, extra) => { console.log((ok ? '✅' : '❌'), name, extra || ''); if (!ok) failures++; };

try {
  // ===== CEO =====
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginForm', { timeout: 30000 });
  await page.fill('#loginUsername', 'ceo');
  await page.fill('#loginPassword', 'CEO@Landyi2026');
  await page.click('#loginSubmit');
  await page.waitForFunction(() => {
    const ov = document.getElementById('loginOverlay');
    return ov && ov.classList.contains('is-hidden');
  }, { timeout: 90000 });
  log('CEO login OK');

  // Registry status rows ปรากฏ
  await page.waitForSelector('.registry-status-row', { timeout: 30000 });
  const rows = await page.$$eval('.registry-status-row', els => els.map(e => e.textContent));
  log('status rows: ' + rows.join(' | '));
  check('registry rows ≥ 5', rows.length >= 5, '(' + rows.length + ')');
  check('แสดง Active Employees', rows.some(r => /Active Employees/.test(r) && /150/.test(r)), rows.find(r => /Active Employees/.test(r)) || '');
  check('แสดง OneDrive Accounts', rows.some(r => /OneDrive/.test(r) && /account-a/.test(r)), rows.find(r => /OneDrive/.test(r)) || '');
  check('แสดง Vectors built', rows.some(r => /Vectors/.test(r) && /built/.test(r)), rows.find(r => /Vectors/.test(r)) || '');

  // ปุ่ม Sync เห็นสำหรับ CEO (topbar — ไม่ถูก chat ทับ) + ปุ่มใน panel
  const topSyncVisible = await page.$eval('#topSyncBtn', b => !b.classList.contains('is-hidden') && !b.disabled).catch(() => false);
  check('topbar sync button visible+enabled (CEO)', topSyncVisible);
  const panelBtnExists = await page.$('#syncOnedriveBtn').then(b => !!b).catch(() => false);
  check('panel sync button exists', panelBtnExists);

  // กด Sync จริง (ปุ่มบน topbar) → รอผลสรุปจริง (ไม่ใช่ข้อความ "กำลัง…")
  await page.click('#topSyncBtn');
  await page.waitForFunction(() => {
    const r = document.getElementById('syncResult');
    if (!r || r.classList.contains('is-hidden')) return false;
    const t = r.textContent;
    return t.length > 0 && !t.includes('กำลัง');
  }, { timeout: 120000 });
  const resultText = await page.$eval('#syncResult', e => e.textContent);
  check('sync result แสดง', /sync 2\/2|สำเร็จ|cache|ล้มเหลว/.test(resultText), resultText);
  const topStatusText = await page.$eval('#topSyncStatus', e => e.textContent).catch(() => '');
  check('topbar status อัปเดต', /⏱|✅|⚠/.test(topStatusText), topStatusText);
  await page.screenshot({ path: SHOT_DIR + '/5-registry-sync.png' });

  // ===== Employee: ปุ่ม Sync ต้องซ่อน =====
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginForm', { timeout: 30000 });
  await page.fill('#loginUsername', 'emp144');
  await page.fill('#loginPassword', 'Emp@2026test');
  await page.click('#loginSubmit');
  await page.waitForFunction(() => {
    const ov = document.getElementById('loginOverlay');
    return ov && ov.classList.contains('is-hidden');
  }, { timeout: 90000 });
  log('emp144 login OK');
  await page.waitForSelector('.registry-status-row', { timeout: 30000 });
  const syncHiddenEmp = await page.$eval('#topSyncBtn', b => b.classList.contains('is-hidden')).catch(() => true);
  check('topbar sync button ซ่อนสำหรับ Employee', syncHiddenEmp);
  const syncHiddenEmpPanel = await page.$eval('#syncOnedriveBtn', b => b.classList.contains('is-hidden')).catch(() => true);
  check('panel sync button ซ่อนสำหรับ Employee', syncHiddenEmpPanel);
  await page.screenshot({ path: SHOT_DIR + '/6-registry-sync-emp.png' });

  // ===== Preview mode =====
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/app.html?preview=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const rs = document.getElementById('registryStatus');
    return rs && rs.textContent.includes('โหมดทดลอง');
  }, { timeout: 15000 });
  check('preview แสดง note โหมดทดลอง', true);
  await page.screenshot({ path: SHOT_DIR + '/7-registry-preview.png' });
} catch (e) {
  console.error('ERROR:', e.message);
  failures++;
  await page.screenshot({ path: SHOT_DIR + '/8-error.png' }).catch(() => {});
}

console.log(failures === 0 ? '\nALL PASS ✅' : '\nFAILURES: ' + failures + ' ❌');
await browser.close();
process.exit(failures === 0 ? 0 : 1);
