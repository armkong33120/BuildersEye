import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', response => {
    if (response.url().includes('/api/auth/login')) {
      console.log('LOGIN FETCH URL:', response.url(), 'STATUS:', response.status());
    }
  });
  
  await page.goto('https://builders-eye.vercel.app/app.html', { waitUntil: 'networkidle' });
  await page.fill('#loginUsername', 'ceo');
  await page.fill('#loginPassword', 'HhAjzrMkw0ODQfr_tH9k1Y81');
  await page.click('#loginSubmit', { force: true });
  await page.waitForTimeout(3000);
  
  await browser.close();
}
run();
