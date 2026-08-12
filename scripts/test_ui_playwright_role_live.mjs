// test_ui_playwright_role_live.mjs — Playwright E2E: live chat → debug page animation (multiple roles)
// ตรวจว่าโหนด pipeline จริง (19 nodes) ที่เพิ่มใน debug page animate ระหว่าง LIVE chat จริง
// ทดสอบ 4 สิทธิ์: CEO / HR / Manager / Employee (local backend users, deployed frontend ผ่าน ?backend=)
// รัน: node scripts/test_ui_playwright_role_live.mjs  (headless, PNA-disabled flags)
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SHOTS_DIR = '/tmp/e2e-shots';
const LOCAL_BACKEND = 'http://localhost:5199';
const APP_URL = 'https://builders-eye.vercel.app/app.html?backend=' + LOCAL_BACKEND;
const DEBUG_URL = 'https://builders-eye.vercel.app/debug_neural_network_diagram.html?backend=' + LOCAL_BACKEND;

const ROLES = [
  { key: 'ceo',        username: 'ceo',    password: process.env.TEST_ACCOUNT_PASSWORD || '[REDACTED]', role: 'CEO',      query: 'CEO คือใคร' },
  { key: 'hr',         username: 'emp135', password: process.env.TEST_ACCOUNT_PASSWORD || '[REDACTED]',      role: 'HR',       query: 'สรุปจำนวนพนักงานแยกแผนก' },
  { key: 'manager',    username: 'emp007', password: process.env.TEST_ACCOUNT_PASSWORD || '[REDACTED]',      role: 'Manager',  query: 'EMP007 คือใคร' },
  { key: 'employee',   username: 'emp012', password: process.env.TEST_ACCOUNT_PASSWORD || '[REDACTED]',      role: 'Employee', query: 'EMP012 คือใคร' },
];

fs.mkdirSync(SHOTS_DIR, { recursive: true });

function log(...a) { console.log(...a); }

async function shoot(page, name) {
  const f = path.join(SHOTS_DIR, name);
  try { await page.screenshot({ path: f }); log(`   📸 ${f}`); } catch (e) { log(`   ⚠️ screenshot ${name}: ${e.message}`); }
}

async function sampleAnimation(page, durationMs) {
  // เก็บตัวอย่างทุก 100ms: q, chip, busy, active(st=1), done(st=2)
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < durationMs) {
    try {
      const s = await page.evaluate(() => {
        const q = document.querySelector('#q'); const chip = document.querySelector('#chip');
        let active = 0, done = 0, total = 0;
        for (const n of nodes.values()) { total++; if (n.st === 1) active++; if (n.st === 2) done++; }
        return { q: q ? q.value : '', chip: chip ? chip.textContent.trim() : '', busy, active, done, total };
      });
      samples.push(s);
    } catch (e) { samples.push({ err: e.message }); }
    await page.waitForTimeout(100);
  }
  return samples;
}

async function runRole(browser, rc) {
  log(`\n=== [${rc.role}] ${rc.username} — query: "${rc.query}" ===`);
  const result = { role: rc.role, username: rc.username, passed: false, detail: '' };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  try {
    // 1) LOGIN
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('#loginOverlay:not(.is-hidden)', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.fill('#loginUsername', rc.username);
    await page.fill('#loginPassword', rc.password);
    await page.click('#loginSubmit');
    await page.waitForFunction(() => {
      const ov = document.getElementById('loginOverlay');
      return !ov || ov.classList.contains('is-hidden');
    }, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const sessionStored = await page.evaluate(() => !!localStorage.getItem('be_access') && !!localStorage.getItem('be_user'));
    await shoot(page, `role-${rc.key}-01-login.png`);

    // dismiss tour if present
    await page.evaluate(() => {
      const b = document.querySelector('#tourTip .tour-skip'); if (b) b.click();
    }).catch(() => {});

    // 2) CHAT (live)
    await page.waitForSelector('#chatInput', { timeout: 15000 });
    await page.fill('#chatInput', rc.query);
    await page.click('#sendChat');
    const answered = await page.waitForFunction((q) => {
      const dots = document.querySelector('.thinking-dots');
      const msgs = document.querySelectorAll('#chatMessages .chat-message');
      const last = msgs[msgs.length - 1];
      return !dots && last && last.textContent.trim().length > 0 && !last.classList.contains('user');
    }, rc.query, { timeout: 45000 }).then(() => true).catch(() => false);
    const answerLen = await page.evaluate(() => {
      const msgs = document.querySelectorAll('#chatMessages .chat-message');
      const last = msgs[msgs.length - 1];
      return last ? last.textContent.trim().length : 0;
    }).catch(() => 0);
    await shoot(page, `role-${rc.key}-02-chat.png`);
    log(`   login: ${sessionStored ? 'OK' : 'NO SESSION'} · chat answered: ${answered} (len=${answerLen})`);

    // 3) DEBUG PAGE — live animation (wait จนกว่า pipeline จะได้ query ของเราจริง แล้วจึงเช็ค animation)
    const dpage = await ctx.newPage();
    dpage.on('pageerror', e => pageErrors.push('[debug] ' + e.message));
    await dpage.goto(DEBUG_URL, { waitUntil: 'load', timeout: 45000 });
    // wait pipeline pick up query (สูงสุด 45s — chat บาง path ช้า เพราะ LLM/SQL)
    const qPicked = await dpage.waitForFunction((q) => {
      const el = document.querySelector('#q');
      const chip = document.querySelector('#chip');
      const v = el ? el.value : '';
      return v.includes(q.slice(0, 6)) && chip && chip.textContent.trim().startsWith('live');
    }, rc.query, { timeout: 45000 }).then(() => true).catch(() => false);
    await dpage.waitForTimeout(500);
    // sample animation อีก 8s หลัง query มาแล้ว (จับ st transitions / done state)
    const samples = await sampleAnimation(dpage, 8000);
    await shoot(dpage, `role-${rc.key}-03-debug.png`);

    // 4) ASSERT
    const last = samples[samples.length - 1] || {};
    const sawBusy = samples.some(s => s.busy === true);
    const sawActive = samples.some(s => s.active > 0);
    const chipLive = last.chip && last.chip.startsWith('live');
    const allVisited = last.done === last.total && last.total === 19;
    // หลักฐานว่า animation วิ่ง: st=2 เกิดจาก run() เท่านั้น → done===19 พิสูจน์ว่าโหนดทุกตัวถูก animate แล้ว
    // (sawBusy/sawActive เป็น timing-dependent — animation จบ ~1s บางครั้ง sample ไม่ทัน)
    const animRan = allVisited || sawBusy || sawActive;

    result.detail = `login=${sessionStored} chat=${answered}(len=${answerLen}) qPicked=${qPicked} chip="${last.chip || ''}" sawBusy=${sawBusy} sawActive=${sawActive} done=${last.done}/${last.total} allVisited=${allVisited} pageErrors=${pageErrors.length}`;
    result.passed = sessionStored && answered && qPicked && chipLive && animRan && pageErrors.length === 0;
    log(`   ${result.passed ? '✅ PASS' : '❌ FAIL'} — ${result.detail}`);
  } catch (err) {
    result.detail = 'EXCEPTION: ' + err.message;
    log(`   ❌ FAIL — ${result.detail}`);
  }
  await ctx.close();
  return result;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-web-security', '--disable-features=BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessPermissionPrompt'],
  });
  const results = [];
  for (const rc of ROLES) results.push(await runRole(browser, rc));
  await browser.close();

  log('\n========================================');
  log('📊 ROLE-MATRIX LIVE CHAT → DEBUG ANIMATION RESULTS');
  log('========================================');
  let allPass = true;
  for (const r of results) {
    log(`  ${r.role.padEnd(9)}: ${r.passed ? '✅ PASS' : '❌ FAIL'} — ${r.detail}`);
    if (!r.passed) allPass = false;
  }
  log('----------------------------------------');
  log('RESULT:', allPass ? '✅ ALL ROLES PASS (19-node animation runs on live chat)' : '❌ SOME ROLES FAILED');
  process.exit(allPass ? 0 : 1);
}

main().catch(err => { console.error('Role-live test failed:', err); process.exit(1); });

