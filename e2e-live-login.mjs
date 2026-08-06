// e2e-live-login.mjs — ทดสอบจริงแบบผู้ใช้: เปิดเว็บ → login → วัดเวลาทุกขั้น + เก็บ screenshot
// ใช้: node e2e-live-login.mjs
import { chromium } from 'playwright';

const BASE = 'https://builders-eye.vercel.app';
const SHOT_DIR = '/tmp/e2e-shots';
import fs from 'fs';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'th-TH' });
const page = await ctx.newPage();
const t = (label, t0) => console.log(`⏱️  ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const T0 = Date.now();
try {
  // 1) เปิดหน้า landing (จุดที่ warmup ยิง)
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  t('landing loaded', T0);
  await page.screenshot({ path: `${SHOT_DIR}/1-landing.png` });

  // 2) ไปหน้า app
  const t1 = Date.now();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  t('app.html loaded', t1);
  await page.screenshot({ path: `${SHOT_DIR}/2-app-login.png` });

  // 3) กรอก login
  const t2 = Date.now();
  await page.waitForSelector('#loginForm', { timeout: 30000 });
  await page.fill('#loginUsername', 'ceo');
  await page.fill('#loginPassword', 'CEO@Landyi2026');
  await page.click('#loginSubmit');
  console.log('🔑 กด login แล้ว รอผล...');

  // 4) รอ overlay หาย (= login สำเร็จ) — timeout 90s เผื่อ cold start
  await page.waitForSelector('#loginOverlay.is-hidden, #loginOverlay[style*="none"]', { state: 'attached', timeout: 90000 })
    .catch(async () => {
      // fallback: เช็ค class is-hidden ผ่าน evaluate
      await page.waitForFunction(() => {
        const ov = document.getElementById('loginOverlay');
        return ov && (ov.classList.contains('is-hidden') || getComputedStyle(ov).display === 'none');
      }, { timeout: 60000 });
    });
  t('LOGIN SUCCESS (overlay หาย)', t2);
  await page.screenshot({ path: `${SHOT_DIR}/3-after-login.png` });

  // 5) ยืนยัน chat ใช้ได้ — พิมพ์ถามสั้นๆ
  const t3 = Date.now();
  await page.waitForSelector('#chatInput', { timeout: 15000 });
  await page.fill('#chatInput', 'CEO คือใคร');
  await page.click('#sendChat');
  await page.waitForFunction(() => {
    const body = document.querySelector('.rag-chat-body');
    return body && body.textContent.includes('ธนกฤต');
  }, { timeout: 90000 });
  t('CHAT ตอบถูก (มีชื่อ CEO)', t3);
  await page.screenshot({ path: `${SHOT_DIR}/4-chat-answer.png` });

  t('✅ TOTAL E2E', T0);
  console.log('\n🎉 ผ่านครบ: landing → login → chat ตอบถูก');
} catch (e) {
  console.error('❌ FAIL:', e.message);
  await page.screenshot({ path: `${SHOT_DIR}/fail.png` }).catch(() => {});
  // dump ข้อความ error บนหน้าจอช่วย debug
  const errText = await page.evaluate(() => document.getElementById('loginError')?.textContent || '').catch(() => '');
  if (errText) console.log('📛 loginError บนหน้าจอ:', errText);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log('📁 screenshots →', SHOT_DIR);
