import { chromium } from 'playwright';

async function testVercel() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://builders-eye.vercel.app/app.html', { waitUntil: 'networkidle' });
  const backendUrl = await page.evaluate(() => window.RAG_BACKEND || 'undefined');
  console.log('Backend URL:', backendUrl);
  await browser.close();
}
testVercel();
