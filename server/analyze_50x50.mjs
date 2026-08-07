import fs from 'fs';

const lines = fs.readFileSync('multirole_50x50_results.csv', 'utf-8').trim().split('\n').slice(1);
const blockedByRole = {}, blockedQ = {}, emptyByRole = {}, emptyQ = {};
let total = 0, empty = 0;
const blockedSamples = [];

function parseCsvLine(line) {
  // 12 คอลัมน์ ที่มี comma ภายในเครื่องหมายคำพูด — split แบบรู้จัก quoted
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

for (const l of lines) {
  const c = parseCsvLine(l);
  if (c.length < 12) continue;
  const [u, role, dept, q, target, status, src, sql, lat, blk, ans, err] = c;
  total++;
  if (blk === '1') {
    blockedByRole[role] = (blockedByRole[role] || 0) + 1;
    const key = q.slice(0, 32);
    blockedQ[key] = (blockedQ[key] || 0) + 1;
    if (blockedSamples.length < 6) blockedSamples.push(`${role} | ${q} | -> ${ans.slice(0, 70)}`);
  }
  if (!ans || ans.length < 2) { empty++; emptyByRole[role] = (emptyByRole[role] || 0) + 1; emptyQ[q.slice(0, 32)] = (emptyQ[q.slice(0, 32)] || 0) + 1; }
}

console.log('total:', total);
console.log('blocked by role:', JSON.stringify(blockedByRole));
console.log('top blocked questions:', JSON.stringify(Object.entries(blockedQ).sort((a, b) => b[1] - a[1]).slice(0, 6)));
console.log('empty answers:', empty, JSON.stringify(emptyByRole));
console.log('top empty questions:', JSON.stringify(Object.entries(emptyQ).sort((a, b) => b[1] - a[1]).slice(0, 5)));
console.log('blocked samples:');
blockedSamples.forEach((s) => console.log('  -', s));
