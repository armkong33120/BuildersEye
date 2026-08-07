// test_multirole_50x50.js — ยิงคำถามสุ่ม 50 ตำแหน่ง × 50 คำถาม (2500) เก็บคำตอบไว้ปรับปรุง
// ใช้ JWT login จริง (เพราะ /api/chat เปลี่ยนเป็น requireAuth แล้ว)
// รัน: cd server && node test_multirole_50x50.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.RAG_BACKEND || 'http://localhost:5199';
const SEED = Number(process.env.TEST_SEED || 20260807);

// ---------- PRNG (seeded, reproducible) ----------
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

// ---------- Load identity graph ----------
const graph = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'identity-graph.json'), 'utf-8'));
const byPk = new Map(graph.identities.map((i) => [i.pk, i]));
const users = JSON.parse(fs.readFileSync(path.join(__dirname, '.data', 'auth', 'users.json'), 'utf-8')).users;

const PASSWORD = { CEO: 'CEO@Landyi2026', HR: 'HR@2026test', Manager: 'Exec@2026test', Employee: 'Emp@2026test' };

// ---------- Question banks ----------
const ceoTemplates = [
  'ขอสรุปประวัติการทำงานและผลประเมินล่าสุดของ {name} ให้หน่อย',
  '{name} ทำงานอยู่แผนกไหนและรับผิดชอบเรื่องอะไรอยู่บ้าง',
  'ช่วงที่ผ่านมา {name} มีผลงานอะไรที่โดดเด่นบ้างไหม',
  'ปีที่แล้ว {name} ได้ KPI เท่าไหร่ และถือว่าอยู่ในเกณฑ์ไหน',
  'เทียบผลงานของ {name} กับคนอื่นๆ ในแผนกเดียวกัน ถือว่าดีกว่าค่าเฉลี่ยไหม',
  '{name} มีประวัติถูกร้องเรียน หรือเคยโดนใบเตือนบ้างหรือเปล่า',
  'ถ้าจะโปรโมท {name} ขึ้นเป็นหัวหน้า คิดว่าจากผลประเมินที่ผ่านมาเหมาะสมไหม',
  'โปรเจกต์ล่าสุดที่ {name} รับผิดชอบคืออะไร ความคืบหน้าเป็นยังไง',
  '{name} มีทักษะหรือความเชี่ยวชาญด้านไหนเป็นพิเศษไหม',
  'ช่วงนี้ {name} ลาบ่อยไหม มีปัญหาเรื่องเวลาการเข้างานหรือเปล่า',
  'ช่วยประเมินจุดแข็งและจุดอ่อนของ {name} จากบันทึกการทำงานให้หน่อย',
  '{name} เคยได้รับรางวัล หรือคำชมเชยจากลูกค้าบ้างไหม',
  'แผนพัฒนาบุคลากร (Training) ของ {name} ปีนี้มีอะไรบ้าง',
  'อยากรู้ว่า {name} ทำงานเข้ากับทีมได้ดีแค่ไหน มีปัญหาเรื่อง Teamwork ไหม',
  'ยอดขายหรือยอด KPI ของ {name} ไตรมาสที่ผ่านมาถึงเป้าหรือเปล่า',
  '{name} ทำงานที่นี่มากี่ปีแล้ว และเติบโตขึ้นจากตำแหน่งแรกยังไงบ้าง',
  'ใครเป็นหัวหน้าสายตรงของ {name} และหัวหน้าประเมินเขาไว้ยังไง',
  '{name} มีภาระงาน (Workload) ล้นมือเกินไปหรือเปล่าช่วงนี้',
  'ผลประเมิน OKR ของ {name} รอบล่าสุด บรรลุเป้าหมายกี่เปอร์เซ็นต์',
  'ถ้าเทียบ {name} กับพนักงานใหม่คนอื่นๆ ถือว่าเรียนรู้งานได้เร็วไหม',
  'มีพนักงานคนไหนในแผนกเดียวกับ {name} ที่ผลงานสูสีกันบ้าง',
  'ช่วยวิเคราะห์ความเสี่ยงที่ {name} จะลาออกให้ฟังหน่อย มีสัญญาณความไม่พอใจไหม',
  '{name} เคยเป็นหัวหน้าโปรเจกต์ไหนบ้างไหม และผลลัพธ์สำเร็จดีไหม',
  'มีคอมเมนต์หรือ Feedback จากเพื่อนร่วมงานเกี่ยวกับ {name} ไหม',
  '{name} ใช้ทรัพยากรหรืออุปกรณ์อะไรของบริษัทอยู่บ้าง',
  'ในอีก 3 ปีข้างหน้า {name} มีแนวโน้มจะเติบโตไปในทิศทางไหนได้บ้าง',
  'ผลงานของ {name} ส่งผลกระทบต่อเป้าหมายหลักของบริษัทปีนี้ยังไง',
  '{name} มีข้อบกพร่องเรื่องอะไรที่ต้องรีบปรับปรุงด่วนที่สุด',
  'ใบเตือนที่ {name} เคยได้รับ เป็นเรื่องร้ายแรงแค่ไหน และเกิดซ้ำไหม',
  'ถ้าบริษัทมีวิกฤต คิดว่า {name} เป็นคนที่จะพึ่งพาได้ไหม',
  '{name} มีความขัดแย้งกับใครในองค์กรบ้างหรือเปล่า',
  'เงินเดือนปัจจุบันของ {name} เหมาะสมกับผลงานที่ทำอยู่ไหม',
  'ขอรายชื่อลูกทีมที่อยู่ใต้บังคับบัญชาของ {name} ทั้งหมดหน่อย',
  'ช่วยสรุปผลงานของ {name} เป็นพอยต์สั้นๆ 3 ข้อ ให้เอาไปใช้ในที่ประชุมบอร์ดหน่อย',
  '{name} มีส่วนร่วมในกิจกรรมส่วนรวมของบริษัทบ้างไหม',
  'ตอนสัมภาษณ์เข้าทำงาน {name} มีจุดเด่นอะไร ทำไมเราถึงรับเขาเข้ามา',
  '{name} มีทักษะความเป็นผู้นำ (Leadership) มากพอที่จะคุมทีมใหญ่ขึ้นไหม',
  'มีอะไรที่บริษัทน่าจะซัพพอร์ตให้ {name} ทำงานได้ดีขึ้นอีกไหม',
  '{name} เคยขอปรับเงินเดือน หรือบ่นเรื่องสวัสดิการบ้างไหม',
  'ในมุมมองของคุณ คิดว่า {name} ขาดทักษะอะไรที่จำเป็นต่อแผนกนี้',
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
  'มีอะไรอัปเดตบ้าง',
  'โปรเจกต์ล่าช้าไหม',
  'ใครได้ KPI สูงสุด',
  'ความเสี่ยงตอนนี้คืออะไร',
  'ข้อร้องเรียนล่าสุด',
  'มีปัญหาอะไรไหม',
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
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(username, role) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD[role] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`login ${username} -> HTTP ${res.status}`);
  return (await res.json()).accessToken;
}

// หาคนที่ viewer เห็น (scope) สำหรับเติม {name}
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

// ---------- Main ----------
async function run() {
  console.log(`🔀 Multi-Role 50x50 Test (seed=${SEED}) — ${BASE}`);
  const fd = fs.openSync('multirole_50x50_results.csv', 'w');
  fs.writeSync(fd, 'Username,Role,Department,Question,TargetEmp,HttpStatus,AnswerSource,SqlUsed,LatencyMs,RbacBlocked,Answer,Error\n');

  // เลือก 50 ตำแหน่ง: CEO 1 + HR 5 + Manager 24 + Employee 20
  const ceo = users.filter((u) => u.role === 'CEO');
  const hrs = shuffle(users.filter((u) => u.role === 'HR'));
  const mgrs = shuffle(users.filter((u) => u.role === 'Manager'));
  const emps = shuffle(users.filter((u) => u.role === 'Employee'));
  const positions = [...ceo, ...hrs, ...mgrs.slice(0, 24), ...emps.slice(0, 20)].slice(0, 50);
  console.log(`ตำแหน่ง: ${positions.length} (CEO ${ceo.length} | HR ${hrs.slice(0, 5).length} | Mgr ${mgrs.slice(0, 24).length} | Emp ${emps.slice(0, 20).length})`);

  let count = 0;
  let ok = 0, errCount = 0, blocked = 0;
  let latSum = 0, latCount = 0;
  const sources = {};
  const byRole = { CEO: [0, 0], HR: [0, 0], Manager: [0, 0], Employee: [0, 0] }; // [ok, total]

  for (const user of positions) {
    let token;
    try {
      token = await login(user.username, user.role);
    } catch (e) {
      console.error(`❌ login ${user.username}: ${e.message}`);
      errCount += 50;
      byRole[user.role][1] += 50;
      for (let i = 0; i < 50; i++) {
        fs.writeSync(fd, `"${user.username}","${user.role}","${user.dept}","LOGIN_FAIL",,401,,,0,0,,"${e.message}"\n`);
      }
      continue;
    }
    const targets = scopedTargets(user);
    const qs = Array.from({ length: 50 }, () => buildQuestion(pick(ALL_QUESTIONS), targets));

    for (const item of qs) {
      const t0 = Date.now();
      try {
        const res = await fetch(`${BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ query: item.q, conversationId: `mr-50x50-${user.username}-${count}` }),
          signal: AbortSignal.timeout(30000),
        });
        const lat = Date.now() - t0;
        const body = await res.json().catch(() => ({}));
        const status = res.status;
        const answer = String(body.answer || '');
        const isBlocked = /🚫|blocked by governance|Query blocked/i.test(answer) || status === 403;
        const source = body.answerSource || body.source || (body.sqlUsed ? 'sql' : 'unknown');
        if (isBlocked) blocked++;
        if (status >= 200 && status < 300 && answer) ok++;
        else errCount++;
        if (status >= 200 && status < 300) { latSum += lat; latCount++; }
        byRole[user.role][0] += (status >= 200 && status < 300 && answer && !isBlocked) ? 1 : 0;
        byRole[user.role][1] += 1;
        sources[source] = (sources[source] || 0) + 1;
        fs.writeSync(fd,
          `"${user.username}","${user.role}","${user.dept}","${item.q.replace(/"/g, '""')}","${item.target}","${status}","${source}","${body.sqlUsed ? 'TRUE' : 'FALSE'}","${lat}",${isBlocked ? 1 : 0},"${answer.slice(0, 400).replace(/"/g, '""').replace(/\n/g, ' ')}",""\n`);
        count++;
        if (count % 250 === 0) {
          console.log(`[${count}/2500] ok=${ok} err=${errCount} blocked=${blocked} avgLat=${(latSum / Math.max(1, latCount)).toFixed(0)}ms`);
          fs.fsyncSync(fd);
        }
      } catch (e) {
        const lat = Date.now() - t0;
        errCount++;
        byRole[user.role][1] += 1;
        fs.writeSync(fd, `"${user.username}","${user.role}","${user.dept}","${item.q.replace(/"/g, '""')}","${item.target}","NETWORK",,,${lat},0,,"${e.message}"\n`);
        count++;
        await delay(1500);
      }
      await delay(250);
    }
    console.log(`✔ done ${user.username} (${user.role}/${user.dept})`);
  }

  fs.closeSync(fd);
  const avgLat = latCount ? (latSum / latCount).toFixed(0) : '0';
  console.log('\n══════════════════════════════════');
  console.log(`✅ เสร็จ 2500 — ok=${ok} err=${errCount} blocked=${blocked}`);
  console.log(`⏱ avgLat=${avgLat}ms`);
  console.log('📊 sources:', JSON.stringify(sources));
  console.log('📊 byRole [ok/total]:');
  for (const [r, [o, t]] of Object.entries(byRole)) console.log(`   ${r}: ${o}/${t} (${t ? Math.round((o / t) * 100) : 0}%)`);
  console.log('💾 saved -> multirole_50x50_results.csv');
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1); });
