import fs from 'fs';
import crypto from 'crypto';

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
}
function nowIso() {
  return new Date().toISOString();
}

const empsData = JSON.parse(fs.readFileSync('./server/.data/registry/employees.json', 'utf8'));
const links = [];

for (const code of Object.keys(empsData)) {
  const emp = empsData[code];
  if (emp.fileName) {
    links.push({
      sourceId: emp.fileName,
      employeeCode: emp.code,
      fileName: emp.fileName,
      provider: 'onedrive',
      shared: false,
      syncStatus: 'success',
      lastSyncedAt: nowIso(),
      linkId: stableId('link', emp.fileName, emp.code),
      enabled: true,
      version: 1,
      createdAt: nowIso()
    });
  }
}

fs.writeFileSync('./server/.data/access/source_links.json', JSON.stringify(links, null, 2));
console.log(`Seeded ${links.length} source links!`);
