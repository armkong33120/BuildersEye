// test_debug_page.mjs — Debug RAG Inspector page focused test
// Usage: node scripts/test_debug_page.mjs
// Env: BACKEND_URL TEST_USERNAME TEST_PASSWORD

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKEND = process.env.BACKEND_URL || 'http://localhost:5199';
const DIST = path.join(ROOT, 'dist', 'debug_neural_network_diagram.html');

let p = 0, f = 0, s = 0;
function ok(name, cond, d) { if (cond) { p++; console.log(`  ✅ ${name}`); } else { f++; console.log(`  ❌ ${name} — ${d}`); } }
function sk(name, r) { s++; console.log(`  ⏭️ ${name} — ${r}`); }

async function fj(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = null; }
  return { s: r.status, d, t };
}

async function main() {
  console.log('🧪 Debug RAG Inspector Page Test\n');

  // 1. Unauthenticated → 401
  console.log('── 1. Unauth debug → 401 ──');
  const pl = await fj(`${BACKEND}/api/debug/pipeline`);
  ok('/api/debug/pipeline → 401', pl.s === 401, `got ${pl.s}`);
  const on = await fj(`${BACKEND}/api/debug/online`);
  ok('/api/debug/online → 401', on.s === 401, `got ${on.s}`);
  const pv = await fj(`${BACKEND}/api/preview/credentials`);
  ok('/api/preview/credentials → 401', pv.s === 401, `got ${pv.s}`);
  try { const lt = await fetch(`${BACKEND}/api/debug/latency`);
    ok('/api/debug/latency → 401', lt.status === 401, `got ${lt.status}`); } catch { sk('/api/debug/latency', 'unreachable'); }

  // 2. Auth login
  console.log('\n── 2. Auth login ──');
  const u = process.env.TEST_USERNAME, pw = process.env.TEST_PASSWORD;
  let tok = null;
  if (u && pw) {
    const lg = await fj(`${BACKEND}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username: u, password: pw }) });
    ok('POST /api/auth/login → 200', lg.s === 200, `got ${lg.s}`);
    if (lg.d?.accessToken) { tok = lg.d.accessToken; ok('Got accessToken', true); }
  } else { sk('Login test', 'no TEST_USERNAME/TEST_PASSWORD'); }

  // 3. Authenticated endpoints
  console.log('\n── 3. Auth debug endpoints → 200 ──');
  if (tok) {
    const h = { Authorization: `Bearer ${tok}` };
    const ap = await fj(`${BACKEND}/api/debug/pipeline`, { headers: h });
    ok('/api/debug/pipeline + token → 200/404', ap.s === 200 || ap.s === 404, `got ${ap.s}`);
    const ao = await fj(`${BACKEND}/api/debug/online`, { headers: h });
    ok('/api/debug/online + token → 200', ao.s === 200, `got ${ao.s}`);
    const av = await fj(`${BACKEND}/api/preview/credentials`, { headers: h });
    ok('/api/preview/credentials + token → 200/403', av.s === 200 || av.s === 403, `got ${av.s}`);
  } else { sk('Auth endpoint tests', 'no token'); }

  // 4-5. Dist HTML
  console.log('\n── 4. Dist HTML security ──');
  if (fs.existsSync(DIST)) {
    const h = fs.readFileSync(DIST, 'utf-8');
    ok('No CEO@Landyi', !/CEO@Landyi/i.test(h));
    ok('No root/1234 gate', !(h.includes('root') && h.includes('1234')));
    ok('No test passwords', !/HR@2026test|Exec@2026test|Emp@2026test/.test(h));
  } else { sk('Dist checks', 'not built'); }

  console.log('\n── 5. Dist HTML features ──');
  if (fs.existsSync(DIST)) {
    const h = fs.readFileSync(DIST, 'utf-8');
    ok('SIGN IN button', h.includes('SIGN IN'));
    ok('RETRIEVAL EVIDENCE', h.includes('RETRIEVAL EVIDENCE'));
    ok('Poll guard', h.includes('if (!currentToken) return'));
    ok('JWT /api/auth/login', h.includes('/api/auth/login'));
    ok('No sessionStorage auth', !h.includes("sessionStorage.setItem('auth"));
  } else { sk('Feature checks', 'not built'); }

  console.log(`\n📊 ${p} passed, ${f} failed, ${s} skipped / ${p+f+s} total`);
  process.exit(f > 0 ? 1 : 0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });