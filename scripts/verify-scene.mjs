import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.env.APP_URL || 'http://127.0.0.1:5174/';
const artifactDir = path.resolve('artifacts');
await fs.mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const logs = [];

page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) logs.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas#scene', { state: 'visible', timeout: 15000 });
await page.waitForTimeout(1400);

const desktopPath = path.join(artifactDir, 'mail-onedrive-org-desktop.png');
await page.screenshot({ path: desktopPath, fullPage: false });
const desktopStats = await pixelStats(desktopPath);

const runtimeStats = await page.evaluate(() => {
  const canvas = document.querySelector('canvas#scene');
  const detail = document.querySelector('#detailPanel')?.innerText || '';
  const personOptions = Array.from(document.querySelectorAll('#personSelect option')).length;
  const departmentOptions = Array.from(document.querySelectorAll('#departmentSelect option')).length;
  const metrics = Array.from(document.querySelectorAll('.metric strong')).map((node) => node.textContent);
  return {
    canvasWidth: canvas?.clientWidth || 0,
    canvasHeight: canvas?.clientHeight || 0,
    detailLength: detail.length,
    personOptions,
    departmentOptions,
    metrics,
  };
});

await page.selectOption('#personSelect', '143');
await page.selectOption('#lineModeSelect', 'subtree');
await page.waitForTimeout(700);
const afterSelect = await page.evaluate(() => ({
  person: document.querySelector('#personSelect')?.value,
  lineMode: document.querySelector('#lineModeSelect')?.value,
  metrics: Array.from(document.querySelectorAll('.metric strong')).map((node) => node.textContent),
  detail: document.querySelector('#detailPanel')?.innerText || '',
}));

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
const mobilePath = path.join(artifactDir, 'mail-onedrive-org-mobile.png');
await page.screenshot({ path: mobilePath, fullPage: false });
const mobileStats = await pixelStats(mobilePath);

await browser.close();

if (logs.some((entry) => entry.includes('error') || entry.includes('pageerror'))) {
  throw new Error(`Browser errors detected:\n${logs.join('\n')}`);
}
if (runtimeStats.canvasWidth < 300 || runtimeStats.canvasHeight < 300) {
  throw new Error(`Canvas too small: ${runtimeStats.canvasWidth}x${runtimeStats.canvasHeight}`);
}
if (runtimeStats.personOptions < 150) {
  throw new Error(`Person options look incomplete: ${runtimeStats.personOptions}`);
}
if (runtimeStats.departmentOptions < 12) {
  throw new Error(`Department options look incomplete: ${runtimeStats.departmentOptions}`);
}
if (desktopStats.distinctColors < 180 || desktopStats.nonBackgroundRatio < 0.06) {
  throw new Error(`Desktop render looks blank: ${JSON.stringify(desktopStats)}`);
}
if (mobileStats.distinctColors < 120 || mobileStats.nonBackgroundRatio < 0.04) {
  throw new Error(`Mobile render looks blank: ${JSON.stringify(mobileStats)}`);
}
if (afterSelect.person !== '143' || afterSelect.lineMode !== 'subtree' || !afterSelect.detail.includes('OneDrive')) {
  throw new Error(`Controls/detail did not update: ${JSON.stringify(afterSelect)}`);
}

console.log(
  JSON.stringify(
    {
      url,
      runtimeStats,
      afterSelect: {
        person: afterSelect.person,
        lineMode: afterSelect.lineMode,
        metrics: afterSelect.metrics,
      },
      desktopStats,
      mobileStats,
      screenshots: {
        desktop: desktopPath,
        mobile: mobilePath,
      },
      warnings: logs,
    },
    null,
    2,
  ),
);

async function pixelStats(filePath) {
  const buffer = await fs.readFile(filePath);
  const png = PNG.sync.read(buffer);
  const colors = new Set();
  let nonBackground = 0;
  let sampled = 0;

  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];
      const a = png.data[idx + 3];
      colors.add(`${r >> 3},${g >> 3},${b >> 3},${a >> 6}`);
      const nearBackground = r < 14 && g < 18 && b < 22;
      if (!nearBackground) nonBackground += 1;
      sampled += 1;
    }
  }

  return {
    width: png.width,
    height: png.height,
    sampled,
    distinctColors: colors.size,
    nonBackgroundRatio: Number((nonBackground / sampled).toFixed(4)),
  };
}
