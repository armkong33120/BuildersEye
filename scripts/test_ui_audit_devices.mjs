// scripts/test_ui_audit_devices.mjs
// Playwright E2E: RBAC Audit Policy Matrix across multiple devices
import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';

function getTestPassword() {
  if (process.env.TEST_ACCOUNT_PASSWORD) return process.env.TEST_ACCOUNT_PASSWORD;
  try {
    const envFile = fs.readFileSync(path.join(process.cwd(), 'server', '.env'), 'utf-8');
    const match = envFile.match(/^TEST_ACCOUNT_PASSWORD=(.*)$/m);
    if (match) return match[1].trim();
  } catch (e) {}
  return '[REDACTED]';
}

const PASSWORD = getTestPassword();
const SHOTS_DIR = '/tmp/e2e-audit-devices';
const APP_URL = 'http://localhost:5174/app.html';
const DEBUG_URL = 'http://localhost:5174/debug_neural_network_diagram.html';

// Representative matrix (subset to avoid taking 4 hours, but architecture supports 20x20)
const USERS = ['ceo', 'it-manager', 'emp012']; 
const QUESTIONS = [
  { q: 'ใครคือ CEO', level: 'Public' },
  { q: 'เงินเดือนของ EMP012', level: 'Restricted' }
];
const TARGET_DEVICES = [
  { name: 'iPhone 13', config: devices['iPhone 13'] },
  { name: 'iPad (Tablet)', config: devices['iPad (gen 7)'] },
  { name: 'MacBook (Desktop)', config: devices['Desktop Chrome'] || { viewport: { width: 1440, height: 900 } } }
];

async function runDeviceAudit() {
  console.log('📱 Starting Multi-Device E2E Audit Matrix via Playwright');
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  
  const browser = await chromium.launch({ headless: true });

  for (const device of TARGET_DEVICES) {
    console.log(`\n========================================`);
    console.log(`🖥️  Testing Device: ${device.name}`);
    console.log(`========================================`);
    
    for (const user of USERS) {
      for (const question of QUESTIONS) {
        console.log(`\n  👤 User: ${user} | ❓ Q: ${question.q} (${question.level})`);
        
        const context = await browser.newContext({
          ...device.config,
          recordVideo: { dir: SHOTS_DIR } // optional: record video if needed
        });
        
        // 1. App Page
        const page = await context.newPage();
        try {
          await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
          
          // Login
          const overlay = page.locator('#loginOverlay');
          await overlay.waitFor({ state: 'visible', timeout: 10000 });
          await page.locator('#loginUsername').fill(user);
          await page.locator('#loginPassword').fill(PASSWORD);
          await page.locator('#loginSubmit').click();
          await overlay.waitFor({ state: 'hidden', timeout: 10000 });
          console.log(`    ✅ Login successful`);
          
          // Dismiss tour
          const skip = page.locator('#tourTip .tour-skip');
          if (await skip.count()) await skip.first().click().catch(()=>{});

          // Ask Question
          await page.locator('#chatInput').fill(question.q);
          await page.locator('#sendChat').click();
          console.log(`    ✅ Question sent`);
          
          // Wait for answer
          await page.waitForFunction(() => {
            const box = document.querySelector('#chatMessages');
            if (!box) return false;
            if (box.querySelector('.thinking-dots')) return false;
            const msgs = box.querySelectorAll('.chat-message');
            if (msgs.length <= 1) return false;
            const last = msgs[msgs.length - 1];
            return !!(last && last.classList.contains('assistant') && last.textContent.trim().length > 0);
          }, null, { timeout: 30000 });
          
          const answer = await page.evaluate(() => {
            const msgs = document.querySelectorAll('#chatMessages .chat-message');
            return msgs.length ? msgs[msgs.length - 1].textContent.trim() : '';
          });
          
          const safeName = `${device.name.replace(/\W/g,'_')}-${user}-${question.level}`;
          await page.screenshot({ path: path.join(SHOTS_DIR, `${safeName}-chat.png`) });
          
          const isBlocked = answer.includes("ขออภัย") || answer.includes("ไม่มีสิทธิ์");
          console.log(`    💬 Response: ${isBlocked ? '🛑 BLOCKED' : '✅ ALLOWED'} (${answer.slice(0, 40).replace(/\n/g, '')}...)`);
          
        } catch (e) {
          console.log(`    ❌ Error in App: ${e.message}`);
        }
        
        // 2. Debug Page
        const debugPage = await context.newPage();
        try {
          await debugPage.goto(DEBUG_URL, { waitUntil: 'networkidle' });
          await debugPage.fill('#gateUser', user).catch(()=>{});
          await debugPage.fill('#gatePass', PASSWORD).catch(()=>{});
          await debugPage.click('#gateBtn').catch(()=>{});
          await debugPage.waitForTimeout(2000);
          
          const qVal = await debugPage.locator('#q').inputValue().catch(() => '');
          console.log(`    🔍 Debug Pipeline saw query: "${qVal}"`);
          
          const safeName = `${device.name.replace(/\W/g,'_')}-${user}-${question.level}`;
          await debugPage.screenshot({ path: path.join(SHOTS_DIR, `${safeName}-debug.png`) });
          
        } catch (e) {
          console.log(`    ❌ Error in Debug: ${e.message}`);
        }
        
        await context.close();
      }
    }
  }
  
  await browser.close();
  console.log('\n✅ Multi-Device E2E Audit complete! Screenshots saved in /tmp/e2e-audit-devices/');
}

runDeviceAudit().catch(console.error);
