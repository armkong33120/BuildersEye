// test_admin_playwright_production.mjs — Playwright E2E for the PRODUCTION Admin Console (BuildersEye)
// เปิด https://builders-eye.vercel.app/admin.html จริงบน CDN + backend Azure Container Apps:
//   1) Login (ceo + TEST_ACCOUNT_PASSWORD อ่านจาก env — ไม่ hardcode, ไม่พิมพ์)
//   2) วนคลิก 7 เมนู (Organization Tree / Data Sources / Permission Matrix / Preview As User /
//      AI Audit Trails / Version History / System Settings) → รอ panel active + เนื้อหา render → screenshot
//   3) รายงาน pass/fail ต่อเมนู + รวบรวม console/page errors
// NOTE: อ่านอย่างเดียว ไม่แตะ data (ไม่ลบพนักงาน, ไม่กด Save System Settings)
//
// วิธีรัน:  TEST_ACCOUNT_PASSWORD='<azure shared test password>' node scripts/test_admin_playwright_production.mjs

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = '/tmp/e2e-admin-shots';
const ADMIN_URL = 'https://builders-eye.vercel.app/admin.html';
const USERNAME = 'ceo';
const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || '';

const MENUS = [
  { key: 'org',        name: 'Organization Tree',  panel: '#section-org',         ready: ['#orgTree'],             requireText: true  },
  { key: 'sources',    name: 'Data Sources',       panel: '#section-sources',     ready: ['#srcTableWrap'],        requireText: true  },
  { key: 'matrix',     name: 'Permission Matrix',  panel: '#section-matrix',      ready: ['#matrixBody'],          requireText: true  },
  { key: 'preview',    name: 'Preview As User',    panel: '#section-preview',     ready: ['#previewBody'],         requireText: true  },
  { key: 'chat-audit', name: 'AI Audit Trails',    panel: '#section-chat-audit',  ready: ['#chatAuditTableWrap'],  requireText: true  },
  { key: 'audit',      name: 'Version History',    panel: '#section-audit',       ready: ['#auditTableWrap'],      requireText: true  },
  { key: 'system',     name: 'System Settings',    panel: '#section-system',      ready: ['#cfgLlmModel', '#sysSaveBtn'], requireText: false },
];

function log(...a) { console.log(...a); }

async function shot(page, name) {
  const file = path.join(SHOTS_DIR, name);
  try { await page.screenshot({ path: file, fullPage: false }); log('   📸 → ' + file); }
  catch (e) { log('   ⚠️ shot ' + name + ' failed: ' + e.message); }
}

const results = MENUS.map(m => ({ key: m.key, name: m.name, passed: false, detail: 'not run' }));

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  if (!PASSWORD) {
    log('✗ TEST_ACCOUNT_PASSWORD env not set. Cannot log in to production admin console.');
    process.exit(2);
  }
  log('🧪 Playwright production Admin Console E2E — ' + ADMIN_URL);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('[console] ' + m.text()); });
  page.on('pageerror', e => pageErrors.push('[pageerror] ' + e.message));

  let loginDetail = 'not attempted';
  try {
    // ---- 1) Login ----
    await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const overlay = page.locator('#adminLoginOverlay');
    await overlay.waitFor({ state: 'visible', timeout: 15000 });
    // NOTE: #adminLoginError is pre-filled by boot() with "Please sign in" — that is NOT a
    // login failure, so we ignore its text and gate strictly on the overlay hiding.
    const tryLogin = async () => {
      await page.fill('#adminLoginUsername', USERNAME);
      await page.fill('#adminLoginPassword', PASSWORD);
      await page.click('#adminLoginSubmit');
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(1000);
        if (await page.evaluate(() => document.getElementById('adminLoginOverlay').classList.contains('is-hidden'))) return true;
      }
      return false;
    };
    const ok = await tryLogin() || (await new Promise(r => setTimeout(r, 8000)), await tryLogin());
    if (!ok) throw new Error('Login did not hide the overlay');

    loginDetail = 'ok';
    log('✅ Login ok (overlay hidden)');
    await shot(page, '00-login.png');

    // ---- 2) walk the 7 menus ----
    for (const m of MENUS) {
      const r = results.find(x => x.key === m.key);
      try {
        await page.click('button[data-section="' + m.key + '"]');
        // panel becomes active
        await page.waitForSelector(m.panel + '.is-active', { timeout: 15000 });
        // ready anchor present + content
        const sel = m.ready[0];
        await page.waitForSelector(sel, { state: 'attached', timeout: 15000 });
        if (m.requireText) {
          const txt = await page.$eval(sel, el => (el.textContent || '').trim());
          await page.waitForFunction(
            s => { const el = document.querySelector(s); return el && (el.textContent || '').trim().length > 0; },
            sel, { timeout: 20000 }
          );
          if (!txt && (await page.$(sel))) {
            // double-check after wait
          }
        } else {
          // System Settings: form present, not clicking Save
          await page.waitForSelector('#sysSaveBtn', { state: 'visible', timeout: 15000 });
          await page.waitForSelector('#cfgLlmModel', { state: 'visible', timeout: 15000 });
        }
        r.passed = true;
        r.detail = 'section active + content rendered';
        log('✅ [' + m.key + '] ' + m.name + ' — ok');
        await shot(page, m.key + '.png');
      } catch (e) {
        r.detail = 'FAIL: ' + e.message.split('\n')[0];
        log('❌ [' + m.key + '] ' + m.name + ' — ' + r.detail);
        await shot(page, m.key + '-FAIL.png');
      }
    }
  } catch (e) {
    loginDetail = 'FAIL: ' + e.message.split('\n')[0];
    log('❌ Login step failed: ' + loginDetail);
    await shot(page, 'login-FAIL.png');
  } finally {
    await browser.close();
  }

  // ---- 3) Report ----
  log('\n===== RESULT =====');
  let passed = 0;
  for (const r of results) { if (r.passed) passed++; log((r.passed ? '✅' : '❌') + ' ' + r.name + ' — ' + r.detail); }
  log('Login: ' + loginDetail);
  log('Passed ' + passed + '/' + results.length + ' menus');
  if (consoleErrors.length) log('\nconsole errors:\n' + consoleErrors.slice(0, 15).join('\n'));
  if (pageErrors.length) { log('\npage errors:\n' + pageErrors.slice(0, 15).join('\n')); process.exitCode = 1; }
  log('screenshots → ' + SHOTS_DIR);
  if (passed === results.length && loginDetail === 'ok') log('✅ ALL MENUS PASSED');
  else { log('❌ Some checks failed'); process.exitCode = 1; }
}

main().catch(e => { log('FATAL ' + e); process.exitCode = 1; });
