// test_ui_playwright.mjs — Playwright E2E UI & Browser Test Suite
// ทดสอบความถูกต้องของ UI บน Google Chrome / Chromium ทั้ง Desktop และ Mobile Viewport

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function runPlaywrightTests() {
  console.log('🧪 Starting Playwright E2E Browser Test Suite (Chromium/Google Chrome)...');
  const browser = await chromium.launch({ headless: true });

  const consoleErrors = [];
  const pageErrors = [];

  // ==========================================
  // TEST 1: DESKTOP VIEWPORT (1280x800)
  // ==========================================
  console.log('\n--- TEST 1: Desktop Viewport (1280x800) ---');
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await desktopContext.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[Desktop Console Error] ${msg.text()}`);
  });
  page.on('pageerror', err => pageErrors.push(`[Desktop Page Error] ${err.message}`));

  console.log('1. Navigating to http://localhost:5174/app.html...');
  await page.goto('http://localhost:5174/app.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Check 3D Canvas
  const canvasExists = await page.locator('#scene').count();
  console.log('2. 3D WebGL Canvas (#scene) present:', canvasExists > 0 ? '✅ YES' : '❌ NO');

  // Check Login Overlay or Preview Mode Button
  const previewBtn = page.locator('#previewModeBtn');
  const hasPreviewBtn = await previewBtn.isVisible();
  console.log('3. Login / Preview Mode Card visible:', hasPreviewBtn ? '✅ YES' : '❌ NO');

  if (hasPreviewBtn) {
    console.log('4. Clicking "🧪 เข้าชมโหมดทดลอง — ไม่ต้อง Login"...');
    await previewBtn.click();
    await page.waitForTimeout(2000);
  }

  // Check User Chip
  const userChip = page.locator('#userChip');
  const isUserChipVisible = await userChip.isVisible();
  const userChipText = await userChip.textContent();
  console.log('5. User Chip (#userChip) visible:', isUserChipVisible ? '✅ YES' : '❌ NO', `(Text: "${userChipText.trim()}")`);

  // Take Desktop Screenshot
  const desktopPicPath = path.join(process.cwd(), 'playwright_desktop.png');
  await page.screenshot({ path: desktopPicPath, fullPage: false });
  console.log('6. Desktop Screenshot saved →', desktopPicPath);

  // ==========================================
  // TEST 2: MOBILE VIEWPORT (390x844 iPhone 12/13/14)
  // ==========================================
  console.log('\n--- TEST 2: Mobile Viewport (390x844) ---');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  });
  const mobilePage = await mobileContext.newPage();

  mobilePage.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[Mobile Console Error] ${msg.text()}`);
  });
  mobilePage.on('pageerror', err => pageErrors.push(`[Mobile Page Error] ${err.message}`));

  console.log('1. Navigating to http://localhost:5174/app.html on Mobile...');
  await mobilePage.goto('http://localhost:5174/app.html', { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(1500);

  const mobPreviewBtn = mobilePage.locator('#previewModeBtn');
  if (await mobPreviewBtn.isVisible()) {
    await mobPreviewBtn.click();
    await mobilePage.waitForTimeout(2000);
  }

  // Check User Chip Position on Mobile
  const mobUserChip = mobilePage.locator('#userChip');
  const isMobUserChipVisible = await mobUserChip.isVisible();
  const chipBox = await mobUserChip.boundingBox();
  console.log('2. Mobile User Chip Visible:', isMobUserChipVisible ? '✅ YES' : '❌ NO', `Position:`, chipBox ? `x:${chipBox.x.toFixed(0)}, y:${chipBox.y.toFixed(0)}, w:${chipBox.width.toFixed(0)}, h:${chipBox.height.toFixed(0)}` : 'N/A');
  
  if (chipBox) {
    const isPinnedTopLeft = chipBox.y < 60 && chipBox.x < 100;
    console.log('3. Mobile User Chip Pinned Top-Left (not floating in center):', isPinnedTopLeft ? '✅ YES (Top-Left)' : '❌ NO (Floating)');
  }

  // Test Chat Input
  const chatInput = mobilePage.locator('#chatInput');
  const sendChatBtn = mobilePage.locator('#sendChat');
  if (await chatInput.isVisible()) {
    console.log('4. Entering test query into RAG Chat...');
    await chatInput.fill('notebook ทั้งบริษัทมีกี่เครื่อง');
    await chatInput.press('Enter');
    await mobilePage.waitForTimeout(3500);

    const chatMessages = mobilePage.locator('#chatMessages');
    const responseText = await chatMessages.textContent();
    console.log('5. RAG Chat Response Received:', responseText.length > 50 ? '✅ YES' : '❌ NO');
  }

  // Take Mobile Screenshot
  const mobilePicPath = path.join(process.cwd(), 'playwright_mobile.png');
  await mobilePage.screenshot({ path: mobilePicPath, fullPage: false });
  console.log('6. Mobile Screenshot saved →', mobilePicPath);

  await browser.close();

  console.log('\n========================================');
  console.log('📊 PLAYWRIGHT E2E BROWSER TEST RESULTS');
  console.log('========================================');
  console.log('Console Errors:', consoleErrors.length);
  if (consoleErrors.length > 0) console.log(consoleErrors);
  console.log('Page Crash Errors:', pageErrors.length);
  if (pageErrors.length > 0) console.log(pageErrors);

  const passed = consoleErrors.length === 0 && pageErrors.length === 0 && isUserChipVisible;
  console.log('RESULT:', passed ? '✅ ALL PLAYWRIGHT UI TESTS PASSED CLEANLY' : '⚠️ UI WARNINGS DETECTED');
  process.exit(passed ? 0 : 1);
}

runPlaywrightTests().catch(err => {
  console.error('Playwright Test Failed:', err);
  process.exit(1);
});
