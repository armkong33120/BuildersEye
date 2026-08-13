// test_ui_playwright_headful.mjs — Playwright HEADFUL E2E test: Login → Chat → Debug
// เปิด Chromium แบบเห็นหน้าจอ (headful: headless:false) เพื่อให้เห็นการทำงานจริงของ BuildersEye:
//   A) Login ที่ app.html (ceo / [TEST_ACCOUNT_PASSWORD]) → overlay หาย + session ถูกเก็บ
//   B) ถาม RAG Chat "CEO คือใคร" → รอคำตอบจาก backend (thinking-dots หาย, มี bubble ใหม่)
//   C) เปิด Debug page (neural network diagram) → pollPipeline ดึง query ไป + มี ceo online
// Screenshot ทั้งหมดเซฟลง /tmp/e2e-shots/
//
// หมายเหตุ: อย่า retry login ซ้ำๆ (rate limit 5 ครั้ง/นาที/username+IP) — ล้มเหลวแล้วให้รายงานแล้วไปต่อ

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SHOTS_DIR = '/tmp/e2e-shots';
const APP_URL = 'http://localhost:5174/app.html';
const DEBUG_URL = 'http://localhost:5174/debug_neural_network_diagram.html';
const CHAT_QUERY = 'CEO คือใคร';
const USERNAME = 'ceo';
const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || '[REDACTED]';

const steps = [
  { id: 'login', title: 'A — App Login', passed: false, detail: 'not run' },
  { id: 'chat', title: 'B — RAG Chat', passed: false, detail: 'not run' },
  { id: 'debug', title: 'C — Debug Page', passed: false, detail: 'not run' },
];
const stepById = Object.fromEntries(steps.map(s => [s.id, s]));
const writtenShots = [];

function log(...args) { console.log(...args); }

async function shoot(page, name) {
  const file = path.join(SHOTS_DIR, name);
  try {
    await page.screenshot({ path: file });
    writtenShots.push(file);
    log(`   📸 screenshot → ${file}`);
  } catch (e) {
    log(`   ⚠️ screenshot ${name} failed: ${e.message}`);
  }
}

// Best-effort: ปิด tour guide ที่อาจขึ้นหลัง login (src/main.js showTourStep #tourTip + .tour-skip)
// จะบัง #chatInput ได้ — ถ้าไม่เจอ selector นี้ก็ข้ามไป ไม่กระทบผลการทดสอบ
async function dismissTour(page) {
  try {
    const skip = page.locator('#tourTip .tour-skip');
    if (await skip.count()) {
      await skip.first().click({ timeout: 3000 });
      log('   🧭 onboarding tour dismissed');
    }
  } catch (e) { /* cosmetic only */ }
}

async function runPlaywrightTests() {
  log('🧪 Starting Playwright HEADFUL E2E test (Login → Chat → Debug)...');
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });

  const consoleErrors = [];
  const pageErrors = [];

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`[App console] ${msg.text()}`); });
  page.on('pageerror', err => pageErrors.push(`[App pageerror] ${err.message}`));

  // ==========================================
  // STEP A — Login (app.html)
  // ==========================================
  try {
    log('\n=== Step A: App Login ===');
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);

    const overlay = page.locator('#loginOverlay');
    await overlay.waitFor({ state: 'visible', timeout: 15000 });
    log('   ✅ #loginOverlay visible — filling credentials');

    await page.locator('#loginUsername').fill(USERNAME);
    await page.locator('#loginPassword').fill(PASSWORD);
    await shoot(page, '01-login.png');

    await page.locator('#loginSubmit').click({ timeout: 10000 });
    // รอจน hideLoginOverlay() ปิด overlay (display:none) — poll สูงสุด 15 วิ
    await overlay.waitFor({ state: 'hidden', timeout: 15000 });

    const sessionOk = await page.evaluate(() => {
      try {
        return !!(localStorage.getItem('be_access') && localStorage.getItem('be_refresh') && localStorage.getItem('be_user'));
      } catch (e) { return false; }
    });
    stepById.login.passed = sessionOk;
    stepById.login.detail = sessionOk
      ? 'overlay hidden + session stored (be_access/be_refresh/be_user)'
      : 'overlay hidden but localStorage session keys missing';
    log(`   ✅ login OK — overlay hidden, session stored: ${sessionOk ? 'YES' : 'NO'}`);
    await shoot(page, '02-after-login.png');

    await dismissTour(page);
  } catch (err) {
    stepById.login.detail = `FAILED: ${err.message}`;
    log(`   ❌ Step A failed: ${err.message}`);
    await shoot(page, '02-after-login.png');
  }

  // ==========================================
  // STEP B — RAG Chat ("CEO คือใคร")
  // ==========================================
  try {
    log('\n=== Step B: RAG Chat ===');
    await dismissTour(page);

    const chatInput = page.locator('#chatInput');
    await chatInput.waitFor({ state: 'visible', timeout: 15000 });

    const beforeCount = await page.locator('#chatMessages .chat-message').count();
    await chatInput.fill(CHAT_QUERY);
    await page.locator('#sendChat').click({ timeout: 10000 });
    log(`   ✅ sent query "${CHAT_QUERY}" (messages before: ${beforeCount})`);

    // รอ: thinking-dots หาย + มี bubble assistant ตัวใหม่ที่มีข้อความไม่ว่าง (poll สูงสุด 20 วิ)
    await page.waitForFunction(
      ({ before }) => {
        const box = document.querySelector('#chatMessages');
        if (!box) return false;
        if (box.querySelector('.thinking-dots')) return false;
        const msgs = box.querySelectorAll('.chat-message');
        if (msgs.length <= before) return false;
        const last = msgs[msgs.length - 1];
        return !!(last && last.classList.contains('assistant') && last.textContent.trim().length > 0);
      },
      { before: beforeCount },
      { timeout: 20000 }
    );

    const answerText = await page.evaluate(() => {
      const msgs = document.querySelectorAll('#chatMessages .chat-message');
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      return last ? last.textContent.trim() : '';
    });
    const thinkingLeft = await page.locator('#chatMessages .thinking-dots').count();

    stepById.chat.passed = answerText.length > 0 && thinkingLeft === 0;
    stepById.chat.detail = stepById.chat.passed
      ? `assistant answer received (${answerText.length} chars), thinking-dots cleared`
      : `no valid assistant answer (answer chars=${answerText.length}, thinking-dots remaining=${thinkingLeft})`;
    log(`   ✅ assistant answer received (${answerText.length} chars), thinking-dots cleared: ${thinkingLeft === 0 ? 'YES' : 'NO'}`);
    await shoot(page, '03-chat-answer.png');
  } catch (err) {
    stepById.chat.detail = `FAILED: ${err.message}`;
    log(`   ❌ Step B failed: ${err.message}`);
    await shoot(page, '03-chat-answer.png');
  }


  // ==========================================
  // STEP C — Debug page (neural network diagram)
  // ==========================================
  const debugPage = await context.newPage();
  debugPage.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`[Debug console] ${msg.text()}`); });
  debugPage.on('pageerror', err => pageErrors.push(`[Debug pageerror] ${err.message}`));

  try {
    log('\n=== Step C: Debug Page ===');
    await debugPage.goto(DEBUG_URL, { waitUntil: 'load', timeout: 30000 });
    await debugPage.waitForTimeout(800);
    // The debug page requires its own JWT SIGN IN — it does not share the
    // app.html session (tokens are held in memory only, never sessionStorage).
    await debugPage.fill('#gateUser', USERNAME).catch(() => {});
    await debugPage.fill('#gatePass', PASSWORD).catch(() => {});
    await debugPage.click('#gateBtn').catch(() => {});
    await debugPage.waitForTimeout(2000);
    await shoot(debugPage, '04-debug-page.png');

    // pollPipeline (ทุก 2 วิ) → #q ต้องได้ query ที่เพิ่งถาม, #chip ต้องขึ้น "backend · ..."
    const pipelinePickedUp = await debugPage
      .waitForFunction(() => {
        const q = document.querySelector('#q');
        const chip = document.querySelector('#chip');
        const qv = q ? q.value : '';
        const cv = chip ? chip.textContent.trim() : '';
        return (qv.includes('CEO') || qv.includes('ใคร')) && cv.includes('backend');
      }, null, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);

    // pollOnline (ทุก 3 วิ) → #online .ol ต้องมี chip ชื่อ "ceo" (session ที่ login อยู่)
    let onlineChip = false;
    try {
      await debugPage.waitForFunction(() => {
        const chips = document.querySelectorAll('#online .ol');
        for (const c of chips) { if (c.textContent.trim() === 'ceo') return true; }
        return false;
      }, null, { timeout: 15000 });
      onlineChip = true;
    } catch (e) { onlineChip = false; }

    const qVal = await debugPage.locator('#q').inputValue().catch(() => '');
    const chipText = await debugPage.locator('#chip').textContent().catch(() => '');
    const onlineText = await debugPage.locator('#online').textContent().catch(() => '');

    stepById.debug.passed = pipelinePickedUp && onlineChip;
    stepById.debug.detail =
      `pipeline picked up query: ${pipelinePickedUp ? 'YES' : 'NO'}, online 'ceo' chip: ${onlineChip ? 'YES' : 'NO'} ` +
      `| q="${qVal}" chip="${(chipText || '').trim()}" online="${(onlineText || '').trim().slice(0, 80)}"`;
    log(`   ✅ pipeline picked up: ${pipelinePickedUp ? 'YES' : 'NO'} · online 'ceo' chip: ${onlineChip ? 'YES' : 'NO'}`);
    log(`      q="${qVal}" chip="${(chipText || '').trim()}"`);
    await shoot(debugPage, '05-debug-assertions.png');
  } catch (err) {
    stepById.debug.detail = `FAILED: ${err.message}`;
    log(`   ❌ Step C failed: ${err.message}`);
    await shoot(debugPage, '05-debug-assertions.png');
  }

  await browser.close();


  // ==========================================
  // SUMMARY
  // ==========================================
  log('\n========================================');
  log('📊 HEADFUL E2E TEST RESULTS (Login → Chat → Debug)');
  log('========================================');
  let allPassed = true;
  for (const s of steps) {
    log(`  ${s.title}: ${s.passed ? '✅ PASS' : '❌ FAIL'} — ${s.detail}`);
    if (!s.passed) allPassed = false;
  }
  log('----------------------------------------');
  log(`Console errors captured: ${consoleErrors.length} (reported only, not failing)`);
  if (consoleErrors.length > 0) log(consoleErrors.map(e => '  ' + e).join('\n'));
  log(`Page errors captured: ${pageErrors.length} (reported only, not failing)`);
  if (pageErrors.length > 0) log(pageErrors.map(e => '  ' + e).join('\n'));
  log('----------------------------------------');
  log('📁 Screenshots written:');
  for (const f of writtenShots) log(`  • ${f}`);
  log('----------------------------------------');

  const passed = allPassed;
  log('RESULT:', passed ? '✅ ALL HEADFUL E2E STEPS PASSED' : '❌ SOME E2E STEPS FAILED (see above)');
  process.exit(passed ? 0 : 1);
}

runPlaywrightTests().catch(err => {
  console.error('Headful E2E test failed:', err);
  process.exit(1);
});

