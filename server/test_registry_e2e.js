// test_registry_e2e.js — ทดสอบ Dynamic Data Layer ครบทุกขั้นในคำสั่งเดียว
// ใช้: node test_registry_e2e.js  (server ต้องรันอยู่ที่ localhost:5199)
const BASE = process.env.BASE_URL || 'http://localhost:5199';
let passed = 0, failed = 0;

function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name} ${extra}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const d = await r.json();
  return d.accessToken;
}

async function get(path, tok) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${tok}` } });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

console.log('🧪 Registry E2E Test —', BASE);

const ceo = await login('ceo', 'CEO@Landyi2026');
const emp = await login('emp144', 'Emp@2026test');
const mgr = await login('it-manager', 'Exec@2026test');
ok('login ceo/emp144/it-manager', Boolean(ceo && emp && mgr));

// 1) status
const st = await get('/api/registry/status', ceo);
ok('status: dataSource=registry', st.data.dataSource === 'registry', `(${st.data.dataSource})`);
ok('status: 150 active', st.data.activeEmployees === 150, `(${st.data.activeEmployees})`);
ok('status: onedrive configured', st.data.onedrive?.configured === true);

// 2) RBAC list
const ceoList = await get('/api/registry/employees', ceo);
ok('CEO เห็นครบ 150', ceoList.data.count === 150, `(${ceoList.data.count})`);
const empList = await get('/api/registry/employees', emp);
ok('Employee เห็นแค่ตัวเอง', empList.data.count === 1 && empList.data.employees[0].code === 'EMP144');
const mgrList = await get('/api/registry/employees', mgr);
ok('IT Manager เห็น subtree 4 คน', mgrList.data.count === 4, `(${mgrList.data.count})`);

// 3) RBAC detail
const denied = await get('/api/registry/employees/EMP001', emp);
ok('Employee ดู CEO → 403', denied.status === 403);
const selfView = await get('/api/registry/employees/EMP144', emp);
ok('Employee ดูตัวเอง: Salary redacted', selfView.data.sheets?.Salary_History?.redacted === true);
const ceoView = await get('/api/registry/employees/EMP144', ceo);
ok('CEO ดู Salary ได้ (ไม่ redact)', Array.isArray(ceoView.data.sheets?.Salary_History?.records));

// 4) schema RBAC
const schemaEmp = await get('/api/registry/schema', emp);
ok('Employee ดู schema → 403', schemaEmp.status === 403);
const schemaCeo = await get('/api/registry/schema', ceo);
ok('CEO ดู schema ได้ (23 sheets)', Object.keys(schemaCeo.data.sheets || {}).length === 23);

// 5) semantic search (ถ้า build เสร็จแล้ว)
const vec = await fetch(`${BASE}/api/search/semantic`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ceo}` },
  body: JSON.stringify({ query: 'ใครมีความเชี่ยวชาญด้าน leadership', k: 3 }),
});
if (vec.status === 503) {
  console.log('  ⏭️  semantic search: ข้าม (vector index ยัง build ไม่เสร็จ)');
} else {
  const vd = await vec.json();
  ok('semantic search คืนผล', vd.available === true && vd.results.length > 0, `(top: ${vd.results?.[0]?.meta?.code} ${vd.results?.[0]?.score})`);
  const empVec = await fetch(`${BASE}/api/search/semantic`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${emp}` },
    body: JSON.stringify({ query: 'salary bonus compensation', k: 5 }),
  });
  const evd = await empVec.json();
  // leak = chunk ของ "คนอื่น" (orgdoc เป็นองค์กร เปิดให้ทุก role ตามดีไซน์)
  const leaked = (evd.results || []).some(r => r.meta?.sensitivity === 'sensitive' || (r.meta?.kind !== 'orgdoc' && r.meta?.code !== 'EMP144'));
  ok('Employee semantic: ไม่รั่วข้อมูลลับ/คนอื่น', !leaked);

  // hybrid mode: exact code ต้องเจอผ่าน keyword leg
  const hyb = await fetch(`${BASE}/api/search/semantic`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ceo}` },
    body: JSON.stringify({ query: 'EMP143', k: 3, mode: 'hybrid' }),
  });
  const hd = await hyb.json();
  const hit143 = (hd.results || []).some(r => r.meta?.code === 'EMP143');
  ok('hybrid mode: exact code EMP143 เจอ', hd.mode === 'hybrid' && hit143);

  // orgdoc: ถามเรื่องระดับบริษัท ต้องเจอ org doc
  const org = await fetch(`${BASE}/api/search/semantic`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ceo}` },
    body: JSON.stringify({ query: 'โปรเจกต์ทั้งหมดที่กำลังดำเนินการ', k: 5 }),
  });
  const od = await org.json();
  const hitOrg = (od.results || []).some(r => r.meta?.kind === 'orgdoc');
  ok('org-doc เข้าถึงได้ (project pipeline)', hitOrg);
}

// 6) chat ยังทำงานกับข้อมูล registry
const chat = await fetch(`${BASE}/api/chat`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ceo}` },
  body: JSON.stringify({ query: 'แผนก IT มีกี่คน' }),
});
const cd = await chat.json();
ok('chat ตอบจาก registry (IT=4)', Array.isArray(cd.matchedEmployeePks) && cd.matchedEmployeePks.length === 4, `(pks: ${JSON.stringify(cd.matchedEmployeePks)})`);

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━\nผล: ${passed} ผ่าน / ${failed} ไม่ผ่าน`);
process.exit(failed > 0 ? 1 : 0);
