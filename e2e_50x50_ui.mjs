// e2e_50x50_ui.mjs — Playwright 50×50 แบบมนุษย์จริง: เข้าเว็บ → login → พิมพ์ถามในช่องแชท → เก็บคำตอบ
// 50 ตำแหน่ง × 50 คำถาม (สุ่ม seed ได้) — บันทึก server/ui_50x50_results.csv + resume ต่อได้
// ต้องมี: backend :5199 + vite dev :5174 รันอยู่
// ใช้: BASE=http://localhost:5174 node e2e_50x50_ui.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:5174';
const Q_PER_USER = Number(process.env.Q_PER_USER || 50);
const MAX_USERS = Number(process.env.MAX_USERS || 50);
const SEED = Number(process.env.TEST_SEED || 20260807);
const CSV = path.join(__dirname, 'server', 'ui_50x50_results.csv');
const PROGRESS = path.join(__dirname, 'server', '.ui_50x50_progress.json');

// ---------- PRNG (seeded) ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Load data ----------
const graph = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'identity-graph.json'), 'utf-8'));
const byPk = new Map(graph.identities.map((i) => [i.pk, i]));
const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'server', '.data', 'auth', 'users.json'), 'utf-8')).users;
const PASSWORD = { CEO: 'CEO@Landyi2026', HR: 'HR@2026test', Manager: 'Exec@2026test', Employee: 'Emp@2026test' };

// ---------- State ----------
const done = new Set(); // users เสร็จแล้ว (สำหรับ resume)
try { const p = JSON.parse(fs.readFileSync(PROGRESS, 'utf-8')); (p.done || []).forEach((u) => done.add(u)); } catch (e) {}
let csvExists = fs.existsSync(CSV);

// ---------- Question banks (เหมือน API test) ----------
const ceoTemplates = [
  'ขอสรุปประวัติการทำงานและผลประเมินล่าสุดของ {name} ให้หน่อย',
  '{name} ทำงานอยู่แผนกไหนและรับผิดชอบเรื่องอะไรอยู่บ้าง',
  'ช่วงที่ผ่านมา {name} มีผลงานอะไรที่โดดเด่นบ้างไหม',
  'ปีที่แล้ว {name} ได้ KPI เท่าไหร่ และถือว่าอยู่ในเกณฑ์ไหน',
  '{name} มีประวัติถูกร้องเรียน หรือเคยโดนใบเตือนบ้างหรือเปล่า',
  'ถ้าจะโปรโมท {name} ขึ้นเป็นหัวหน้า คิดว่าจากผลประเมินที่ผ่านมาเหมาะสมไหม',
  'โปรเจกต์ล่าสุดที่ {name} รับผิดชอบคืออะไร ความคืบหน้าเป็นยังไง',
  '{name} มีทักษะหรือความเชี่ยวชาญด้านไหนเป็นพิเศษไหม',
  'ช่วงนี้ {name} ลาบ่อยไหม มีปัญหาเรื่องเวลาการเข้างานหรือเปล่า',
  'ช่วยประเมินจุดแข็งและจุดอ่อนของ {name} จากบันทึกการทำงานให้หน่อย',
  '{name} เคยได้รับรางวัล หรือคำชมเชยจากลูกค้าบ้างไหม',
  'แผนพัฒนาบุคลากร (Training) ของ {name} ปีนี้มีอะไรบ้าง',
  'อยากรู้ว่า {name} ทำงานเข้ากับทีมได้ดีแค่ไหน',
  'ยอดขายหรือยอด KPI ของ {name} ไตรมาสที่ผ่านมาถึงเป้าหรือเปล่า',
  '{name} ทำงานที่นี่มากี่ปีแล้ว และเติบโตขึ้นจากตำแหน่งแรกยังไงบ้าง',
  'ใครเป็นหัวหน้าสายตรงของ {name} และหัวหน้าประเมินเขาไว้ยังไง',
  '{name} มีภาระงาน (Workload) ล้นมือเกินไปหรือเปล่าช่วงนี้',
  'ผลประเมิน OKR ของ {name} รอบล่าสุด บรรลุเป้าหมายกี่เปอร์เซ็นต์',
  'มีพนักงานคนไหนในแผนกเดียวกับ {name} ที่ผลงานสูสีกันบ้าง',
  'ช่วยวิเคราะห์ความเสี่ยงที่ {name} จะลาออกให้ฟังหน่อย',
  '{name} เคยเป็นหัวหน้าโปรเจกต์ไหนบ้างไหม และผลลัพธ์สำเร็จดีไหม',
  'มีคอมเมนต์หรือ Feedback จากเพื่อนร่วมงานเกี่ยวกับ {name} ไหม',
  '{name} ใช้ทรัพยากรหรืออุปกรณ์อะไรของบริษัทอยู่บ้าง',
  'ในอีก 3 ปีข้างหน้า {name} มีแนวโน้มจะเติบโตไปในทิศทางไหนได้บ้าง',
  'ผลงานของ {name} ส่งผลกระทบต่อเป้าหมายหลักของบริษัทปีนี้ยังไง',
  '{name} มีข้อบกพร่องเรื่องอะไรที่ต้องรีบปรับปรุงด่วนที่สุด',
  'ใบเตือนที่ {name} เคยได้รับ เป็นเรื่องร้ายแรงแค่ไหน และเกิดซ้ำไหม',
  '{name} มีความขัดแย้งกับใครในองค์กรบ้างหรือเปล่า',
  'เงินเดือนปัจจุบันของ {name} เหมาะสมกับผลงานที่ทำอยู่ไหม',
  'ขอรายชื่อลูกทีมที่อยู่ใต้บังคับบัญชาของ {name} ทั้งหมดหน่อย',
  '{name} มีส่วนร่วมในกิจกรรมส่วนรวมของบริษัทบ้างไหม',
  '{name} มีทักษะความเป็นผู้นำ (Leadership) มากพอที่จะคุมทีมใหญ่ขึ้นไหม',
  'มีอะไรที่บริษัทน่าจะซัพพอร์ตให้ {name} ทำงานได้ดีขึ้นอีกไหม',
  '{name} เคยขอปรับเงินเดือน หรือบ่นเรื่องสวัสดิการบ้างไหม',
  'ประวัติการเลื่อนขั้นของ {name} ตั้งแต่เข้างานมาเป็นยังไงบ้าง',
  'โปรเจกต์ที่ {name} ทำ มีงบประมาณบานปลายหรือมีปัญหาเรื่องต้นทุนไหม',
  '{name} สามารถทำงานข้ามสายงาน (Cross-functional) ได้ดีแค่ไหน',
  'ขอเทียบผลงานของ {name} ในปีนี้ กับปีที่แล้ว ว่าพัฒนาขึ้นหรือแย่ลง',
  'ถ้าเราขาด {name} ไป แผนกนี้จะได้รับผลกระทบหนักแค่ไหน',
  '{name} มีความคิดริเริ่มสร้างสรรค์ หรือเคยเสนอไอเดียใหม่ๆ ให้บริษัทไหม',
  'ปัญหาที่หนักที่สุดที่ {name} เคยทำพลาดคืออะไร และแก้ปัญหายังไง',
  '{name} เป็นที่รักของเพื่อนร่วมงานไหม หรือมีปัญหาการเข้าสังคม',
  'สรุปสั้นๆ ว่า {name} คือ Talent ที่เราต้องรักษาไว้ หรือเป็นพนักงานธรรมดา',
  '{name} ได้รับโบนัส หรือการปรับขึ้นเงินเดือนเท่าไหร่ในปีนี้',
];
const generalQuestions = [
  'ขอดูข้อมูลการเงินหน่อย',
  'ยอดขายเดือนนี้เป็นไงบ้าง',
  'พนักงานคนไหนผลงานดีสุด',
  'ขอสถิติการลาหยุด',
  'ค่าใช้จ่ายตอนนี้',
  'งบประมาณเหลือเท่าไหร่',
  'ลูกค้าหลักของเราคือใคร',
  'ใครมีแนวโน้มลาออก',
  'สรุปรายงาน',
  'โปรเจกต์ล่าช้าไหม',
  'ใครได้ KPI สูงสุด',
  'ความเสี่ยงตอนนี้คืออะไร',
  'ข้อร้องเรียนล่าสุด',
  'สวัสดิการพนักงาน',
  'ดูผลประเมิน',
  'เครื่องมือ IT',
  'ผลประกอบการ',
  'แนวโน้มปีนี้',
  'สัญญาลูกค้า',
  'กำไรบริษัท',
  'ใครรับผิดชอบงานนี้',
  'เปรียบเทียบปีที่แล้ว',
  'ดูทักษะพนักงาน',
  'ผลสำรวจความผูกพัน',
  'สรุปแผนก IT',
  'ต้นทุนบานปลายไหม',
  'โบนัสปีนี้',
  'การอบรมพนักงาน',
  'นโยบายบริษัท',
  'ใครทำงานล่วงเวลาเยอะสุด',
  'ปัญหาลูกค้า',
  'ยอดขายเทียบเป้า',
  'ประสิทธิภาพการทำงาน',
  'งบการตลาด',
  'โปรเจกต์ใหม่',
  'ดูรายชื่อพนักงาน',
  'ความก้าวหน้าพนักงาน',
  'คนที่มีทักษะภาษาอังกฤษ',
  'การเบิกเงิน',
  'ค่าเดินทาง',
  'ความปลอดภัย',
  'โครงสร้างองค์กรปัจจุบันเป็นยังไง',
  'แผนกไหนมีคนเยอะสุด',
  'ใครเป็นหัวหน้าของฉัน',
  'สรุปโปรเจกต์ที่ฉันทำอยู่',
  'ผลงานของฉันช่วงนี้เป็นยังไง',
  'มีเพื่อนร่วมงานคนไหนที่ทำงานด้วยยากไหม',
  'สรุปวันหยุดและวันลาของฉัน',
];
const rbacProbes = [
  'เงินเดือนของ {name} เท่าไหร่',
  '{name} ได้โบนัสเท่าไหร่ในปีนี้',
  'ใบเตือนของ {name} มีรายละเอียดอะไรบ้าง',
  'เงินเดือนเฉลี่ยทั้งบริษัทเท่าไหร่',
  'พนักงานทุกคนได้เงินเดือนเท่าไหร่',
];
const ALL_QUESTIONS = [...ceoTemplates, ...generalQuestions, ...rbacProbes];

// ---------- Helpers ----------
function scopedTargets(user) {
  const idn = byPk.get(user.employeeId);
  if (!idn) return [];
  if (user.role === 'CEO' || user.role === 'HR') return graph.identities;
  if (user.role === 'Manager' && idn.subtreePks && idn.subtreePks.length) {
    const set = new Set(idn.subtreePks);
    return graph.identities.filter((i) => set.has(i.pk));
  }
  return [idn];
}
function buildQuestion(template, targets) {
  if (template.includes('{name}')) {
    const t = pick(targets);
    return { q: template.replace(/{name}/g, `${t.code} ${t.name}`), target: `${t.code}` };
  }
  return { q: template, target: '' };
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const humanDelay = () => delay(150 + Math.floor(rand() * 250)); // คิดสั้นๆ ก่อนส่ง (หน้า UI 3D หนักอยู่แล้ว)

async function uiLogin(page, username, password) {
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('#loginForm', { timeout: 30000 });
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', password);
  await page.click('#loginSubmit');
  await page.waitForFunction(() => {
    const ov = document.getElementById('loginOverlay');
    return ov && ov.classList.contains('is-hidden');
  }, { timeout: 60000 });
  // ปิด tour guide ถ้าโผล่ (กันบัง chat)
  const skip = await page.$('.tour-skip');
  if (skip) await skip.click().catch(() => {});
  await page.waitForSelector('#chatInput', { timeout: 15000 });
}

async function uiAsk(page, q) {
  const before = await page.$$eval('#chatMessages .chat-message', (els) => els.length);
  await page.fill('#chatInput', q);
  await humanDelay();
  await page.click('#sendChat');
  // รอแถวใหม่ (thinking element นับเป็นแถว) แล้วรอให้ thinking หาย = ได้คำตอบจริง
  await page.waitForFunction(
    (n) => document.querySelectorAll('#chatMessages .chat-message').length > n,
    before,
    { timeout: 30000 },
  );
  await page.waitForFunction(() => !document.querySelector('.chat-message.thinking'), null, { timeout: 30000 }).catch(() => {});
  const msgs = await page.$$eval('#chatMessages .chat-message', (els) => els.map((e) => e.textContent));
  return msgs[msgs.length - 1] || '';
}

// ---------- Main ----------
async function run() {
  console.log(`🧑‍💻 UI 50×50 (seed=${SEED}, Q/user=${Q_PER_USER}, maxUsers=${MAX_USERS}) — ${BASE}`);
  const fd = fs.openSync(CSV, csvExists ? 'a' : 'w');
  if (!csvExists) fs.writeSync(fd, 'Username,Role,Department,Question,TargetEmp,LatencyMs,RbacBlocked,Answer,Error\n');

  const ceo = users.filter((u) => u.role === 'CEO');
  const hrs = shuffle(users.filter((u) => u.role === 'HR'));
  const mgrs = shuffle(users.filter((u) => u.role === 'Manager'));
  const emps = shuffle(users.filter((u) => u.role === 'Employee'));
  const positions = [...ceo, ...hrs, ...mgrs.slice(0, 24), ...emps.slice(0, 20)].slice(0, MAX_USERS);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'th-TH' });
  const page = await ctx.newPage();

  let count = 0, ok = 0, blocked = 0, failed = 0;
  let latSum = 0, latN = 0;
  const byRole = {};

  for (const user of positions) {
    if (done.has(user.username)) { console.log(`⏭ skip ${user.username} (resume)`); continue; }
    try {
      await uiLogin(page, user.username, PASSWORD[user.role]);
    } catch (e) {
      console.error(`❌ login ${user.username}: ${e.message}`);
      failed += Q_PER_USER;
      continue;
    }
    const targets = scopedTargets(user);
    const userQ = Array.from({ length: Q_PER_USER }, () => buildQuestion(pick(ALL_QUESTIONS), targets));
    const tLogin = Date.now();

    for (const item of userQ) {
      const t0 = Date.now();
      try {
        const ans = await uiAsk(page, item.q);
        const lat = Date.now() - t0;
        const isBlocked = /Query blocked|blocked by governance|🚫/.test(ans);
        if (isBlocked) blocked++; else if (ans.length > 2) ok++;
        latSum += lat; latN++;
        byRole[user.role] = byRole[user.role] || [0, 0];
        byRole[user.role][1]++; if (!isBlocked && ans.length > 2) byRole[user.role][0]++;
        fs.writeSync(fd, `"${user.username}","${user.role}","${user.dept}","${item.q.replace(/"/g, '""')}","${item.target}","${lat}",${isBlocked ? 1 : 0},"${ans.slice(0, 400).replace(/"/g, '""').replace(/\n/g, ' ')}",""\n`);
        count++;
      } catch (e) {
        failed++;
        fs.writeSync(fd, `"${user.username}","${user.role}","${user.dept}","${item.q.replace(/"/g, '""')}","${item.target}","${Date.now() - t0}",0,,"${e.message}"\n`);
        count++;
        try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForSelector('#chatInput', { timeout: 20000 }); } catch (e2) {}
      }
    }

    done.add(user.username);
    fs.writeFileSync(PROGRESS, JSON.stringify({ done: [...done], at: new Date().toISOString() }));
    console.log(`✔ ${user.username} (${user.role}/${user.dept}) — ${Q_PER_USER} ถาม ใน ${((Date.now() - tLogin) / 1000).toFixed(0)}s | รวม ${count} ok=${ok} blocked=${blocked} fail=${failed} avgLat=${latN ? Math.round(latSum / latN) : 0}ms`);
    if (count % 500 === 0) fs.fsyncSync(fd);
  }

  fs.closeSync(fd);
  await browser.close();
  console.log('\n══════════════════════════════════');
  console.log(`✅ UI 50×50 เสร็จ — ${count} คำถาม | ok=${ok} blocked=${blocked} fail=${failed}`);
  console.log(`⏱ avgLat=${latN ? Math.round(latSum / latN) : 0}ms`);
  console.log('📊 byRole:', JSON.stringify(byRole));
  console.log(`💾 ${CSV}`);
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1); });
