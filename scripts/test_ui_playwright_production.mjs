// test_ui_playwright_production.mjs — Playwright HEADFUL E2E test for the PRODUCTION environment of BuildersEye
// เปิด Chromium แบบเห็นหน้าจอ (headful: headless:false) ทดสอบ PRODUCTION (https://builders-eye.vercel.app) เป็น 3 scenarios:
//   S1) Pure Production login attempt — คาดหวัง FAIL (security-by-design): login ceo/CEO@Landyi2026 กับ prod backend
//       ต้องโดน 401 → #loginError แสดง error, overlay ยังอยู่, app ไม่ crash. (ห้าม retry — rate limit 5 ครั้ง/นาที)
//   S2) Production frontend + LOCAL backend ผ่าน ?backend=http://localhost:5199 — full flow:
//       Login (สำเร็จ) → RAG Chat (รอ answer) → Debug page (pipeline อัปเดตเป็น query ใหม่ + chip live + ceo online)
//   S3) Pure Production debug page (ไม่มี ?backend=) — ตรวจ default state: preset เริ่มต้น, chip = "ollama",
//       online = 0 (ไม่มีใคร login บน prod)
// Screenshot ทั้งหมดเซฟลง /tmp/e2e-shots/
// หมายเหตุ: อย่า retry prod login ซ้ำๆ (rate limit 5 ครั้ง/นาที/username+IP) — ล้มเหลวแล้วให้รายงานแล้วไปต่อ

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SHOTS_DIR = '/tmp/e2e-shots';
const PROD_FRONTEND = 'https://builders-eye.vercel.app';
const PROD_APP_URL = PROD_FRONTEND + '/app.html';
const PROD_DEBUG_URL = PROD_FRONTEND + '/debug_neural_network_diagram.html';
const LOCAL_BACKEND = 'http://localhost:5199';
const USERNAME = 'ceo';
const PASSWORD = 'CEO@Landyi2026';
// ต้องต่างจาก query ที่มีอยู่แล้วใน local pipeline ("CEO คือใคร") เพื่อให้ debug page อัปเดตให้เห็นชัดเจน
const S2_QUERY = 'ประวัติและการทำงานของ CEO';

const scenarios = [
  { id: 's1', title: 'S1 — Pure Production login attempt (expected FAIL, security-by-design)', passed: false, detail: 'not run' },
  { id: 's2', title: 'S2 — Prod frontend + Local backend (?backend=): Login → Chat → Debug + Online', passed: false, detail: 'not run' },
  { id: 's3', title: 'S3 — Pure Production debug page (default preset, online=0)', passed: false, detail: 'not run' },
];
const scenarioById = Object.fromEntries(scenarios.map(s => [s.id, s]));
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

function attachListeners(page, label, consoleErrors, pageErrors) {
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`[${label} console] ${msg.text()}`); });
  page.on('pageerror', err => pageErrors.push(`[${label} pageerror] ${err.message}`));
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
  log('🧪 Starting Playwright HEADFUL PRODUCTION E2E test (S1 prod login / S2 prod+local / S3 prod debug)...');
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // Chrome Private Network Access (PNA): the public HTTPS origin (https://builders-eye.vercel.app) is blocked from
  // calling the loopback http://localhost:5199 by default, which fails S2 (?backend=http://localhost:5199).
  // The flags below disable those PNA checks so S2 can exercise the full prod-frontend + local-backend flow.
  // TEST-HARNESS ONLY — these launch flags never affect S1/S3, which use the prod origin only and make no loopback calls.
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-web-security', '--disable-features=BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessPermissionPrompt'],
  });

  const consoleErrors = [];
  const pageErrors = [];

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // ==========================================
  // SCENARIO 1 — Pure Production login attempt (expected FAIL)
  // ==========================================
  const page = await context.newPage();
  attachListeners(page, 'S1 app', consoleErrors, pageErrors);

  try {
    log('\n=== Scenario 1: Pure Production Login attempt (expected FAIL) ===');
    await page.goto(PROD_APP_URL, { waitUntil: 'networkidle', timeout: 45000 });

    const overlay = page.locator('#loginOverlay');
    await overlay.waitFor({ state: 'visible', timeout: 20000 });
    log('   ✅ #loginOverlay visible (no session on prod) — attempting login with known creds');

    await page.locator('#loginUsername').fill(USERNAME);
    await page.locator('#loginPassword').fill(PASSWORD);
    await shoot(page, 'prod-s1-login-attempt.png');

    await page.locator('#loginSubmit').click({ timeout: 10000 });

    // รอสูงสุด ~12 วิ จนกว่าจะได้อย่างใดอย่างหนึ่ง: (a) overlay ปิด, หรือ (b) #loginError ขึ้นข้อความสุดท้าย
    // (เช็คเพิ่มว่า #loginSubmit กลับมา enabled + ข้อความเดิม = doLogin จบแล้ว จะได้ไม่นับข้อความ warm-up ชั่วคราว)
    let errorText = '';
    let overlayHidden = false;
    try {
      await page.waitForFunction(() => {
        const ov = document.querySelector('#loginOverlay');
        if (ov && getComputedStyle(ov).display === 'none') return true;
        const er = document.querySelector('#loginError');
        const et = er ? er.textContent.trim() : '';
        const btn = document.querySelector('#loginSubmit');
        const btnReady = btn && !btn.disabled && (btn.textContent || '').trim() === 'เข้าสู่ระบบ';
        return et.length > 0 && btnReady;
      }, null, { timeout: 12000 });
      overlayHidden = await overlay.isHidden().catch(() => false);
      errorText = (await page.locator('#loginError').textContent().catch(() => '')).trim();
    } catch (e) {
      // timeout — ยังไม่มีผลลัพธ์ชัดเจนใน 12 วิ: อ่านค่าเท่าที่ได้
      overlayHidden = await overlay.isHidden().catch(() => false);
      errorText = (await page.locator('#loginError').textContent().catch(() => '')).trim();
    }

    const overlayPresent = (await page.locator('#loginOverlay').count()) > 0;
    const readyState = await page.evaluate(() => document.readyState).catch(() => 'CRASHED');
    await shoot(page, 'prod-s1-login-error.png');

    // PASS = แสดง error ให้ user เห็นชัดเจน + ไม่ crash (page ยังอยู่, #loginOverlay ยังมี) + overlay ยังเปิดอยู่
    const s1pass = !overlayHidden && errorText.length > 0 && overlayPresent;
    scenarioById.s1.passed = s1pass;
    scenarioById.s1.detail = s1pass
      ? `expected failure confirmed: overlay stays visible + clear error shown → #loginError="${errorText.slice(0, 120)}" (prod blocks known creds, security-by-design)`
      : `unexpected: overlayHidden=${overlayHidden}, errorText="${errorText.slice(0, 120)}", overlayPresent=${overlayPresent}, readyState=${readyState}`;
    log(`   ${s1pass ? '✅' : '❌'} #loginError="${errorText.slice(0, 120)}" | overlayHidden=${overlayHidden} overlayPresent=${overlayPresent}`);
  } catch (err) {
    scenarioById.s1.detail = `FAILED: ${err.message}`;
    log(`   ❌ Scenario 1 failed: ${err.message}`);
    await shoot(page, 'prod-s1-login-error.png');
  }


  // ==========================================
  // SCENARIO 2 — Production frontend + LOCAL backend via ?backend= (full flow)
  // ==========================================
  try {
    log('\n=== Scenario 2: Prod frontend + Local backend (?backend=) — Login → Chat → Debug + Online ===');
    const page2 = await context.newPage();
    attachListeners(page2, 'S2 app', consoleErrors, pageErrors);

    // 2A — Login กับ local backend (backend URL มากจาก ?backend= ชนะเสมอ)
    await page2.goto(`${PROD_APP_URL}?backend=${encodeURIComponent(LOCAL_BACKEND)}`, { waitUntil: 'networkidle', timeout: 45000 });
    const overlay2 = page2.locator('#loginOverlay');
    await overlay2.waitFor({ state: 'visible', timeout: 20000 });
    log('   ✅ #loginOverlay visible (prod frontend + local backend via ?backend=)');

    await page2.locator('#loginUsername').fill(USERNAME);
    await page2.locator('#loginPassword').fill(PASSWORD);
    await page2.locator('#loginSubmit').click({ timeout: 10000 });
    await overlay2.waitFor({ state: 'hidden', timeout: 15000 });

    const sessionOk = await page2.evaluate(() => {
      try {
        return !!(localStorage.getItem('be_access') && localStorage.getItem('be_refresh') && localStorage.getItem('be_user'));
      } catch (e) { return false; }
    });
    const beAccessPresent = await page2.evaluate(() => !!localStorage.getItem('be_access')).catch(() => false);
    log(`   ✅ login OK — overlay hidden, session stored (be_access): ${sessionOk ? 'YES' : 'NO'}`);
    await shoot(page2, 'prod-s2-after-login.png');

    await dismissTour(page2);

    // 2B — RAG Chat: query ใหม่ (ไม่ซ้ำ "CEO คือใคร") → รอ answer
    const chatInput = page2.locator('#chatInput');
    await chatInput.waitFor({ state: 'visible', timeout: 15000 });

    const beforeCount = await page2.locator('#chatMessages .chat-message').count();
    await chatInput.fill(S2_QUERY);
    await page2.locator('#sendChat').click({ timeout: 10000 });
    log(`   ✅ sent query "${S2_QUERY}" (messages before: ${beforeCount})`);

    // รอ: thinking-dots หาย + มี bubble assistant ตัวใหม่ที่มีข้อความไม่ว่าง (poll สูงสุด 35 วิ — LLM/DeepSeek ช้า)
    await page2.waitForFunction(
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
      { timeout: 35000 }
    );

    const answerText = await page2.evaluate(() => {
      const msgs = document.querySelectorAll('#chatMessages .chat-message');
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      return last ? last.textContent.trim() : '';
    });
    const thinkingLeft = await page2.locator('#chatMessages .thinking-dots').count();
    log(`   ✅ assistant answer received (${answerText.length} chars), thinking-dots cleared: ${thinkingLeft === 0 ? 'YES' : 'NO'}`);
    await shoot(page2, 'prod-s2-chat-answer.png');


    // 2C — Debug page (new tab ใน context เดียวกัน, ?backend=local) — pipeline อัปเดตเป็น query ใหม่ + chip live
    const debugPage = await context.newPage();
    attachListeners(debugPage, 'S2 debug', consoleErrors, pageErrors);
    await debugPage.goto(`${PROD_DEBUG_URL}?backend=${encodeURIComponent(LOCAL_BACKEND)}`, { waitUntil: 'load', timeout: 45000 });
    await debugPage.waitForTimeout(1500);

    // pollPipeline (ทุก 2 วิ) → #q ต้องมี query ใหม่ (หรือ 'CEO') และ #chip ต้องขึ้น "live · HH:MM:SS"
    const pipelinePickedUp = await debugPage
      .waitForFunction(
        ({ nq }) => {
          const q = document.querySelector('#q');
          const chip = document.querySelector('#chip');
          const qv = q ? q.value : '';
          const cv = chip ? chip.textContent.trim() : '';
          return (qv.includes(nq) || qv.includes('CEO')) && cv.startsWith('live');
        },
        { nq: S2_QUERY },
        { timeout: 20000 }
      )
      .then(() => true)
      .catch(() => false);

    const qVal = await debugPage.locator('#q').inputValue().catch(() => '');
    const chipText = (await debugPage.locator('#chip').textContent().catch(() => '')).trim();
    log(`   ✅ debug pipeline picked up new query: ${pipelinePickedUp ? 'YES' : 'NO'} | q="${qVal}" chip="${chipText}"`);
    await shoot(debugPage, 'prod-s2-debug-live.png');

    // pollOnline (ทุก 3 วิ) → #online .ol ต้องมี chip ชื่อ "ceo" (session ที่ login กับ local backend)
    let onlineChip = false;
    try {
      await debugPage.waitForFunction(() => {
        const chips = document.querySelectorAll('#online .ol');
        for (const c of chips) { if (c.textContent.trim() === 'ceo') return true; }
        return false;
      }, null, { timeout: 15000 });
      onlineChip = true;
    } catch (e) { onlineChip = false; }

    const onlineText = (await debugPage.locator('#online').textContent().catch(() => '')).trim();
    log(`   ✅ online 'ceo' chip: ${onlineChip ? 'YES' : 'NO'} | online="${onlineText.slice(0, 120)}"`);
    await shoot(debugPage, 'prod-s2-debug-online.png');

    const s2pass = sessionOk && beAccessPresent && answerText.length > 0 && thinkingLeft === 0 && pipelinePickedUp && onlineChip;
    scenarioById.s2.passed = s2pass;
    scenarioById.s2.detail = s2pass
      ? `full flow OK: login+session=YES, chat answer=${answerText.length} chars, debug live (q="${qVal.slice(0, 60)}", chip="${chipText}"), ceo online=YES`
      : `login=${sessionOk} be_access=${beAccessPresent} answerChars=${answerText.length} thinkingLeft=${thinkingLeft} pipeline=${pipelinePickedUp} onlineChip=${onlineChip} online="${onlineText.slice(0, 120)}"`;
  } catch (err) {
    scenarioById.s2.detail = `FAILED: ${err.message}`;
    log(`   ❌ Scenario 2 failed: ${err.message}`);
  }


  // ==========================================
  // SCENARIO 3 — Pure Production debug page (online = 0, default preset)
  // ==========================================
  try {
    log('\n=== Scenario 3: Pure Production debug page (default preset) ===');
    // context ใหม่ = เหมือนผู้เยี่ยมชมใหม่บน prod (ไม่มี session/localStorage) → เป็น "pure production" จริงๆ
    const prodContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page3 = await prodContext.newPage();
    attachListeners(page3, 'S3 debug', consoleErrors, pageErrors);

    await page3.goto(PROD_DEBUG_URL, { waitUntil: 'load', timeout: 45000 });
    await page3.waitForTimeout(8000); // ปล่อย pollPipeline (ทุก 2 วิ) + pollOnline (ทุก 3 วิ) ทำงานสักพัก

    const qVal3 = await page3.locator('#q').inputValue().catch(() => '');
    const chipText3 = (await page3.locator('#chip').textContent().catch(() => '')).trim();
    const onlineCount3 = await page3.locator('#online .ol').count();
    const onlineNone3 = await page3.locator('#online .ol-none').count();
    const onlineText3 = (await page3.locator('#online').textContent().catch(() => '')).trim();
    const pageAlive = await page3.evaluate(() => {
      return document.querySelector('#q') !== null && document.querySelector('#chip') !== null && document.querySelector('#online') !== null;
    }).catch(() => false);

    log(`   ✅ page loaded (alive=${pageAlive}); q="${qVal3}" chip="${chipText3}" | #online .ol=${onlineCount3}, .ol-none=${onlineNone3}`);
    log(`     online text="${onlineText3.slice(0, 160)}"`);
    await shoot(page3, 'prod-s3-debug-default.png');

    // PASS = โหลด default state ได้โดยไม่ crash + chip ยังเป็น default ("ollama") + online count = 0 (ไม่มีใคร login บน prod)
    const s3pass = pageAlive && chipText3 === 'ollama' && onlineCount3 === 0;
    scenarioById.s3.passed = s3pass;
    scenarioById.s3.detail = s3pass
      ? `default state confirmed: q="${qVal3.slice(0, 60)}", chip="${chipText3}", online count=0 (${onlineNone3 > 0 ? 'แสดง "—"' : ''}) — nobody logged in on prod`
      : `unexpected state: alive=${pageAlive}, q="${qVal3.slice(0, 60)}", chip="${chipText3}", onlineCount=${onlineCount3}, ol-none=${onlineNone3}`;
  } catch (err) {
    scenarioById.s3.detail = `FAILED: ${err.message}`;
    log(`   ❌ Scenario 3 failed: ${err.message}`);
  }

  await browser.close();


  // ==========================================
  // SUMMARY
  // ==========================================
  log('\n========================================');
  log('📊 PRODUCTION HEADFUL E2E TEST RESULTS');
  log('========================================');
  let allPassed = true;
  for (const s of scenarios) {
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
  log('RESULT:', passed ? '✅ ALL PRODUCTION E2E STEPS PASSED' : '❌ SOME PRODUCTION E2E STEPS FAILED (see above)');
  process.exit(passed ? 0 : 1);
}

runPlaywrightTests().catch(err => {
  console.error('Production E2E test failed:', err);
  process.exit(1);
});

