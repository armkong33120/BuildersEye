// appInsightsSetup.js — ต้องถูก import เป็นอันดับแรกสุดของ index.js เสมอ
// เหตุ: ESM โหลด static imports ก่อนเสมอ → ถ้า express โหลดก่อน SDK จะ patch http ไม่ทัน
// → auto-collection เงียบ (อาการ: connected แต่ไม่มีข้อมูล) — แยกไฟล์นี้แก้ปัญหานั้น
import { createRequire } from 'module';

if (process.env.APPINSIGHTS_CONNECTION_STRING) {
  try {
    const require = createRequire(import.meta.url);
    const appInsights = require('applicationinsights');
    appInsights.setup(process.env.APPINSIGHTS_CONNECTION_STRING)
      .setAutoCollectRequests(true)      // เก็บทุก HTTP request (url, status, duration)
      .setAutoCollectDependencies(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectConsole(true, true) // เก็บ console.log → traces (รวม login audit)
      .setAutoCollectPerformance(true, true)
      .setSendLiveMetrics(true)
      .start();
    console.log('[appinsights] connected + collecting');
  } catch (e) {
    console.warn('[appinsights] init failed (continuing without it):', e.message);
  }
}
