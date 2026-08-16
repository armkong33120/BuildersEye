// test_vector_staleness.mjs — Unit tests for vector index staleness detection.
// Run: node scripts/test_vector_staleness.mjs
// Uses temp VECTOR_DATA_DIR / REGISTRY_EMPLOYEES_FILE so it never touches real data.

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-vec-stale-'));
const VEC_DIR = path.join(TMP, 'vectors');
const REG_FILE = path.join(TMP, 'registry', 'employees.json');
fs.mkdirSync(VEC_DIR, { recursive: true });
fs.mkdirSync(path.dirname(REG_FILE), { recursive: true });

// Set env BEFORE importing vectorStore (module-level path constants).
process.env.VECTOR_DATA_DIR = VEC_DIR;
process.env.REGISTRY_EMPLOYEES_FILE = REG_FILE;
delete process.env.DATABASE_URL;

const { isVectorIndexStale } = await import('../server/vectorStore.js');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

console.log('🧪 Vector staleness detection unit tests\n');

const CHUNKS = path.join(VEC_DIR, 'chunks.jsonl');
const META = path.join(VEC_DIR, 'meta.json');

// ── No vectors yet → not stale ──
assert('no vectors → not stale', isVectorIndexStale() === false);

// ── Vectors built, registry older → not stale ──
fs.writeFileSync(CHUNKS, JSON.stringify({ id: 'c1', text: 'x', meta: { code: 'EMP001' }, vector: [0.1] }) + '\n');
fs.writeFileSync(META, JSON.stringify({ model: 'm', count: 1, builtAt: new Date().toISOString() }));
fs.writeFileSync(REG_FILE, '{}');
const now = Date.now();
fs.utimesSync(CHUNKS, new Date(now), new Date(now));
fs.utimesSync(REG_FILE, new Date(now - 60_000), new Date(now - 60_000)); // registry older
assert('registry older than vectors → not stale', isVectorIndexStale() === false);

// ── Registry newer than vectors → stale (org change after build) ──
fs.utimesSync(REG_FILE, new Date(now + 60_000), new Date(now + 60_000)); // registry newer
assert('registry newer than vectors → stale', isVectorIndexStale() === true);

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
