// test_source_links.mjs — Unit tests for Data Source Link ingestion gating.
// Run: node scripts/test_source_links.mjs
// Uses a temp ACCESS_DATA_DIR so it never touches real runtime data.

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-srclink-test-'));
process.env.ACCESS_DATA_DIR = TMP;

const {
  seedAccessModel,
  findSourceLink,
  isSourceEnabled,
  sourceOwner,
  canIngestSource,
  adminService,
} = await import('../server/access/index.js');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

console.log('🧪 Source link gating unit tests\n');

seedAccessModel({ employees: [
  { code: 'EMP001', pk: 1, name: 'CEO', jobTitle: 'CEO', roleGroup: 'CEO', department: 'Executive', managerCode: '' },
]});

const admin = { username: 'ceo', employeeId: 1, role: 'CEO' };

// ── No link → ingest as-is (backward compatible) ──
assert('no link → enabled', isSourceEnabled('EMP001.xlsx') === true);
assert('no link → can ingest', canIngestSource('EMP001.xlsx', 'EMP001') === true);

// ── Create a link + basename matching ──
adminService.createSourceLink(admin, { sourceId: 'onedrive/EMP001.xlsx', employeeCode: 'EMP001' });
assert('basename match finds link', !!findSourceLink('EMP001.xlsx'));
assert('owner resolved', sourceOwner('EMP001.xlsx') === 'EMP001');
assert('owner can ingest own source', canIngestSource('EMP001.xlsx', 'EMP001') === true);
assert('non-owner blocked (duplicate ownership)', canIngestSource('EMP001.xlsx', 'EMP002') === false);

// ── Disable the link ──
const link = findSourceLink('EMP001.xlsx');
adminService.updateSourceLink(admin, link.linkId, { enabled: false });
assert('disabled source not enabled', isSourceEnabled('EMP001.xlsx') === false);
assert('disabled source blocks even owner', canIngestSource('EMP001.xlsx', 'EMP001') === false);

// ── Shared link allows multiple owners ──
adminService.updateSourceLink(admin, link.linkId, { enabled: true, shared: true });
assert('shared source allows non-owner', canIngestSource('EMP001.xlsx', 'EMP002') === true);

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
