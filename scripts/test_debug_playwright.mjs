// scripts/test_debug_playwright.mjs
// Playwright headless comparison: Local dist/ vs Production debug page
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'debug_neural_network_diagram.html');
const LOCAL_URL = 'file://' + DIST;
const PROD_URL = 'https://builders-eye.vercel.app/debug_neural_network_diagram.html';
let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log('  \u2705 ' + label); }
  else { fail++; console.log('  \u274c ' + label + ' \u2014 ' + detail); }
}

async function testTarget(browser, label, url, opts = {}) {
  const { expectSignInGate = true, takeScreenshot = false } = opts;
  console.log('\n' + '\u2550'.repeat(60));
  console.log('\U0001f3af ' + label);
  console.log('   URL: ' + url);
  console.log('\u2550'.repeat(60));
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    bypassCSP: true,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push('[PageError] ' + err.message));
  try {
    console.log('\n\U0001f4c4 Loading page...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const title = await page.title();
    ok('1. Page loaded (has title)', title.length > 0, 'title="' + title.slice(0,80) + '"');
    const gateVisible = await page.locator('#gate').isVisible().catch(() => false);
    const gateBtnText = await page.locator('#gateBtn').textContent().catch(() => '');
    if (expectSignInGate) {
      ok('2. SIGN IN gate is visible', gateVisible, gateVisible ? 'button="' + gateBtnText + '"' : 'gate hidden');
      ok('2b. Gate shows SIGN IN (not root/1234)',
         gateBtnText.includes('SIGN IN') || gateBtnText.includes('Sign in'),
         'got: "' + gateBtnText + '"');
      ok('2c. No "root" in gate button', !gateBtnText.includes('root'), 'button text = "' + gateBtnText + '"');
    }
    const gateHTML = await page.locator('#gateBox').innerHTML().catch(() => '');
    ok('2d. No "1234" in gate box', !gateHTML.includes('1234'), gateHTML.includes('1234') ? 'FOUND 1234' : '');
    const bodyText = await page.locator('body').textContent().catch(() => '');
    const hasCredsError = /credentials error/i.test(bodyText);
    ok('3. No "credentials error" on page', !hasCredsError, hasCredsError ? 'credentials error visible' : '');
    const credsStatus = await page.locator('#credsStatus').textContent().catch(() => '');
    ok('3b. #credsStatus clean', !/credentials error/i.test(credsStatus), 'status="' + credsStatus + '"');
    const evidencePane = await page.locator('#evidencePane').isVisible().catch(() => false);
    const evidenceText = await page.locator('#evidencePane').textContent().catch(() => '');
    ok('4. RETRIEVAL EVIDENCE pane exists', evidencePane || evidenceText.includes('RETRIEVAL EVIDENCE'),
       evidencePane ? 'visible' : 'text="' + evidenceText.slice(0,60) + '"');
    const canvas = await page.locator('#cv').isVisible().catch(() => false);
    const canvasCount = await page.locator('canvas').count().catch(() => 0);
    ok('5. Canvas (#cv) exists', canvas || canvasCount > 0,
       'canvas visible=' + canvas + ', count=' + canvasCount);
    if (canvasCount > 0) {
      const box = await page.locator('canvas').first().boundingBox().catch(() => null);
      ok('5b. Canvas has non-zero dimensions', box && box.width > 0 && box.height > 0,
         box ? box.width + 'x' + box.height : 'no bounding box');
    }
    if (consoleErrors.length > 0) {
      console.log('\n  \u26a0\ufe0f  Console errors (' + consoleErrors.length + '):');
      const unique = [...new Set(consoleErrors)];
      unique.slice(0, 10).forEach(e => console.log('     ' + e.slice(0,200)));
      if (unique.length > 10) console.log('     ... and ' + (unique.length - 10) + ' more');
    } else { console.log('\n  \u2705 No console errors'); }
    if (pageErrors.length > 0) {
      console.log('\n  \u26a0\ufe0f Page errors (' + pageErrors.length + '):');
      pageErrors.slice(0, 5).forEach(e => console.log('     ' + e));
    } else { console.log('  \u2705 No page errors'); }
    if (takeScreenshot) {
      const shotName = label.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() + '.png';
      const shotPath = path.join(ROOT, shotName);
      await page.screenshot({ path: shotPath, fullPage: false });
      console.log('  \U0001f4f8 Screenshot \u2192 ' + shotPath);
    }
    const gateH1 = await page.locator('#gateBox h1').textContent().catch(() => '(none)');
    const gateP = await page.locator('#gateBox p').textContent().catch(() => '(none)');
    console.log('\n  \U0001f4cb Gate heading: "' + gateH1 + '"');
    console.log('  \U0001f4cb Gate subtitle: "' + gateP + '"');
    return { consoleErrors, pageErrors, gateBtnText, gateHTML, bodyText, credsStatus, gateH1, gateP };
  } catch (e) {
    console.log('  \u274c Test crashed: ' + e.message);
    fail++;
    return { consoleErrors, pageErrors, gateBtnText: '', gateHTML: '', bodyText: '', credsStatus: '', gateH1: '', gateP: '' };
  } finally {
    await context.close();
  }
}

async function main() {
  console.log('\U0001f9ea Playwright Debug Page Comparison Test');
  console.log('   Local: ' + LOCAL_URL);
  console.log('   Prod:  ' + PROD_URL + '\n');
  if (!fs.existsSync(DIST)) {
    console.log('\u274c Local dist not found at: ' + DIST);
    process.exit(1);
  }
  console.log('\u2705 Local dist exists (' + (fs.statSync(DIST).size / 1024).toFixed(1) + ' KB)\n');
  const browser = await chromium.launch({ headless: true });
  const localResult = await testTarget(browser, 'TARGET A -- Local dist/', LOCAL_URL, {
    expectSignInGate: true, takeScreenshot: true,
  });
  const prodResult = await testTarget(browser, 'TARGET B -- Production (Vercel)', PROD_URL, {
    expectSignInGate: true, takeScreenshot: true,
  });
  await browser.close();
  console.log('\n' + '\u2550'.repeat(60));
  console.log('\U0001f4ca COMPARISON REPORT');
  console.log('\u2550'.repeat(60));
  console.log('\n\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u252c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
  function row(n,l,p) {
    const a = (l||'').slice(0,38).padEnd(38);
    const b = (p||'').slice(0,38).padEnd(38);
    console.log('\u2502 ' + n.padEnd(20) + ' \u2502 ' + a + ' \u2502 ' + b + ' \u2502');
  }
  row('Gate heading', localResult.gateH1, prodResult.gateH1);
  row('Gate subtitle', localResult.gateP, prodResult.gateP);
  row('Gate button text', localResult.gateBtnText, prodResult.gateBtnText);
  row('Has "root" in gate', localResult.gateHTML.includes('root')?'YES \u26a0\ufe0f':'NO \u2705', prodResult.gateHTML.includes('root')?'YES \u26a0\ufe0f':'NO \u2705');
  row('Has "1234" in gate', localResult.gateHTML.includes('1234')?'YES \u26a0\ufe0f':'NO \u2705', prodResult.gateHTML.includes('1234')?'YES \u26a0\ufe0f':'NO \u2705');
  row('"credentials error"', /credentials error/i.test(localResult.bodyText)?'YES \u26a0\ufe0f':'NO \u2705', /credentials error/i.test(prodResult.bodyText)?'YES \u26a0\ufe0f':'NO \u2705');
  row('#credsStatus', localResult.credsStatus.slice(0,36), prodResult.credsStatus.slice(0,36));
  row('Console errors', '' + localResult.consoleErrors.length, '' + prodResult.consoleErrors.length);
  row('Page errors', '' + localResult.pageErrors.length, '' + prodResult.pageErrors.length);
  console.log('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');
  console.log('\n\U0001f50d KEY DIFFERENCES:');
  const diffs = [];
  if (localResult.gateBtnText !== prodResult.gateBtnText) diffs.push('Gate button: LOCAL="' + localResult.gateBtnText + '" vs PROD="' + prodResult.gateBtnText + '"');
  if (localResult.gateHTML.includes('root') !== prodResult.gateHTML.includes('root')) diffs.push('"root" in gate: LOCAL=' + localResult.gateHTML.includes('root') + ' PROD=' + prodResult.gateHTML.includes('root'));
  if (localResult.gateHTML.includes('1234') !== prodResult.gateHTML.includes('1234')) diffs.push('"1234" in gate: LOCAL=' + localResult.gateHTML.includes('1234') + ' PROD=' + prodResult.gateHTML.includes('1234'));
  const lce = /credentials error/i.test(localResult.bodyText);
  const pce = /credentials error/i.test(prodResult.bodyText);
  if (lce !== pce) diffs.push('"credentials error": LOCAL=' + lce + ' PROD=' + pce);
  if (localResult.consoleErrors.length !== prodResult.consoleErrors.length) diffs.push('Console errors: LOCAL=' + localResult.consoleErrors.length + ' PROD=' + prodResult.consoleErrors.length);
  if (diffs.length === 0) console.log('  \u2705 Both targets behave identically for the key checks.');
  else diffs.forEach(d => console.log('  \u26a0\ufe0f  ' + d));
  console.log('\n\U0001f4ca Final: ' + pass + ' passed, ' + fail + ' failed / ' + (pass+fail) + ' checks');
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
