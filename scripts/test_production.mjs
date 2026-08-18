import { chromium, devices } from 'playwright';

const APP_URL = 'https://builders-eye.vercel.app/app.html';
const PASSWORD = 'HhAjzrMkw0ODQfr_tH9k1Y81';

async function testVercel() {
  console.log(`🚀 Starting Playwright test against Production: ${APP_URL}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  try {
    console.log(`Navigating to ${APP_URL}...`);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });

    console.log(`Logging in as ceo...`);
    await page.waitForSelector('#loginUsername', { state: 'visible', timeout: 10000 });
    await page.fill('#loginUsername', 'ceo');
    await page.fill('#loginPassword', PASSWORD);
    await page.click('#loginSubmit');
    
    console.log(`Waiting for chat UI...`);
    await page.waitForSelector('#chatMessages', { state: 'visible', timeout: 15000 });
    console.log('✅ Login successful!');

    const queries = [
      'เงินเดือนพนักงานเฉลี่ยเท่าไหร่',
      'ใครคือผู้จัดการของฝ่าย IT'
    ];

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      console.log(`Sending query: "${query}"...`);
      await page.fill('#chatInput', query);
      await page.click('#sendChat');
      
      // The backend might take 50+ seconds to wake up!
      await page.waitForSelector(`.chat-bubble.assistant:nth-child(${(i + 1) * 2})`, { state: 'attached', timeout: 90000 });
      console.log(`✅ Received response for: "${query}"`);
    }
    
    console.log('✅ All queries sent to Production successfully! The logs are now in the DB.');

  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await browser.close();
  }
}

testVercel();
