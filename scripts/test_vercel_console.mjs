import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('requestfailed', request => console.log('REQ FAILED:', request.url(), request.failure().errorText));
  
  await page.goto('https://builders-eye.vercel.app/app.html', { waitUntil: 'networkidle' });
  await page.fill('#loginUsername', 'ceo');
  await page.fill('#loginPassword', process.env.TEST_ACCOUNT_PASSWORD || '');
  await page.click('#loginSubmit', { force: true });
  await page.waitForTimeout(3000);
  
  await browser.close();
}
run();
