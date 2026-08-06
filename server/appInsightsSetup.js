// appInsightsSetup.js — ต้องถูก import เป็นอันดับแรกสุดของ index.js เสมอ
// เหตุ: ESM โหลด static imports ก่อนเสมอ → ถ้า express โหลดก่อน SDK จะ patch http ไม่ทัน
// → auto-collection เงียบ (อาการ: connected แต่ไม่มีข้อมูล) — แยกไฟล์นี้แก้ปัญหานั้น
import { createRequire } from 'module';

let client = null;

if (process.env.APPINSIGHTS_CONNECTION_STRING) {
  try {
    const require = createRequire(import.meta.url);
    const appInsights = require('applicationinsights');
    appInsights.setup(process.env.APPINSIGHTS_CONNECTION_STRING)
      .setAutoCollectRequests(true)      // เก็บทุก HTTP request (url, status, duration)
      .setAutoCollectDependencies(true)
      .setAutoCollectExceptions(true)
      // console auto-collect ปิด (FIX #5) — เดิม console.log ถูกเก็บซ้ำ 2 รอบ
      // (console capture + SDK request capture). ตอนนี้ใช้ trackAudit() แบบ explicit แทน
      // → ได้ event สะอาด ไม่ซ้ำ และ filter ได้ง่ายกว่า (customEvents)
      .setAutoCollectConsole(false)
      .setAutoCollectPerformance(true, true)
      .setSendLiveMetrics(true)
      .start();
    client = appInsights.defaultClient;
    console.log('[appinsights] connected + collecting');
  } catch (e) {
    console.warn('[appinsights] init failed (continuing without it):', e.message);
  }
}

// Explicit audit event — ใช้แทน console.log ในจุดที่อยากให้เห็นใน App Insights.
// ถ้าไม่มี App Insights ก็ fallback เป็น console.log (ดูใน container logs ได้เหมือนเดิม)
export function trackAudit(name, properties = {}) {
  if (client) {
    try { client.trackEvent({ name, properties }); } catch (e) { /* noop */ }
  } else {
    console.log(`[audit] ${name} ${JSON.stringify(properties)}`);
  }
}

// Track a request metric (latency + status) — ใช้ที่จุดสำคัญ (เช่น login)
export function trackMetric(name, value, properties = {}) {
  if (client) {
    try { client.trackMetric({ name, value, properties }); } catch (e) { /* noop */ }
  }
}

export function flushAudit() {
  if (client) { try { client.flush(); } catch (e) { /* noop */ } }
}
