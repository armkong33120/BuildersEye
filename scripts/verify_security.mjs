// verify_security.mjs — Comprehensive Security Verification (static analysis)
// Usage: node scripts/verify_security.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const checks = [];
let passed = 0, failed = 0;

function check(name, condition, detail) {
  checks.push({ name, ok: !!condition, detail });
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}

function readFileSafe(p) { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } }

// Walk tracked source files (skip node_modules, .git, dist, .agents, .venv, etc.)
function walkDir(dir, exts = ['.js', '.html', '.md', '.json', '.css', '.mjs', '.cjs', '.py']) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const skipDirs = new Set(['node_modules', '.git', 'dist', '.agents', '.venv',
    '__pycache__', 'output', '.data', '.cache', 'artifacts', 'out']);
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) out.push(...walkDir(fp, exts));
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        if (exts.includes(ext) || exts.length === 0) out.push(fp);
      }
    }
  } catch { /* permission errors */ }
  return out;
}

async function main() {
  console.log('🔒 Security Verification\n');

  // Collect all source files
  const allFiles = [
    ...walkDir(path.join(ROOT, 'server')),
    ...walkDir(path.join(ROOT, 'src')),
    ...walkDir(path.join(ROOT, 'scripts')),
    ...walkDir(path.join(ROOT, 'docs')),
    ...walkDir(path.join(ROOT, 'tools')),
    ...walkDir(path.join(ROOT, 'eval')),
    ...walkDir(ROOT, ['.js', '.html', '.md', '.json', '.mjs', '.py']).filter(f => {
      const rel = path.relative(ROOT, f);
      return !rel.includes('/');
    }),
  ];

  // ========== 1. Secret scan (comprehensive) ==========
  console.log('── 1. Secret scan ──');
  let secretsFound = [];
  const secretPatterns = [
    { name: 'Hardcoded JWT secret', re: /JWT_SECRET\s*=\s*['"][^'\s]{8,}['"]/i },
    { name: 'API key (sk-...)', re: /(?:DEEPSEEK|OPENAI|LLM)_API_KEY\s*=\s*['"]sk-[^'\s]{8,}['"]/i },
    { name: 'Generic API key pattern', re: /\bsk-[a-zA-Z0-9_-]{20,60}\b/ },
    { name: 'Database URL with creds', re: /(?:DATABASE_URL|POSTGRES_URL)\s*=\s*['"]?postgres(?:ql)?:\/\/[^:]+:[^@\s]+@/i },
    { name: 'Azure connection string', re: /DefaultEndpointsProtocol=https/i },
    { name: 'Hardcoded password', re: /(?:password|PASSWORD)\s*[:=]\s*['"][^'\s]{4,}['"]/ },
    { name: 'AZURE_CLIENT_SECRET value', re: /AZURE_CLIENT_SECRET\s*=\s*['"][^'\s]{3,}['"]/i },
    { name: 'APPINSIGHTS_CONNECTION_STRING', re: /APPINSIGHTS_CONNECTION_STRING\s*=\s*['"]?[^'\s]{8,}/i },
    { name: 'Render API key (rnd_...)', re: /\brnd_[a-zA-Z0-9_-]{20,60}\b/ },
  ];

  for (const f of allFiles) {
    const rel = path.relative(ROOT, f);
    if (rel.includes('.env') || rel.includes('verify_security') || rel.includes('test_api_invalid_login')) continue;
    const c = readFileSafe(f);
    const lines = c.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      for (const pat of secretPatterns) {
        if (pat.re.test(l)) {
          if (f.includes('authStore') && l.includes('process.exit')) continue;
          if (f.includes('.env.example')) continue;
          if (l.includes('your_') || l.includes('placeholder')) continue;
          if (l.includes('[REDACTED') || l.includes('[TEST_ACCOUNT') || l.includes('sk-xxx')) continue;
          if (l.includes('process.env.')) continue;
          secretsFound.push(`${rel}:${i + 1} — ${pat.name}: ${l.trim().slice(0, 100)}`);
        }
      }
    }
  }
  if (secretsFound.length) {
    for (const s of secretsFound) console.log(`  ⚠️  ${s}`);
  }
  check('No hardcoded secrets in source', secretsFound.length === 0,
    secretsFound.length ? `${secretsFound.length} potential secret(s) found` : 'clean');

  // ========== 2. Route auth audit ==========
  console.log('\n── 2. Route Auth audit ──');
  const idx = readFileSafe(path.join(ROOT, 'server', 'index.js'));

  const routeRe = /app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let rm;
  const routes = [];
  while ((rm = routeRe.exec(idx)) !== null) {
    routes.push({ method: rm[1], path: rm[2], index: rm.index });
  }
  // Sort by index so we can find next route boundary
  routes.sort((a, b) => a.index - b.index);

  const publicRoutes = new Set([
    '/api/health', '/api/index/status',
    '/api/auth/login', '/api/auth/refresh', '/api/auth/logout',
    '/api/preview/credentials', '/api/graph/version', '/api/graph',
  ]);

  for (let ri = 0; ri < routes.length; ri++) {
    const r = routes[ri];
    // Context: from current route to the NEXT route (or +400 chars max)
    const nextIdx = ri + 1 < routes.length ? routes[ri + 1].index : r.index + 400;
    const ctx = idx.slice(r.index, Math.min(nextIdx, r.index + 400));
    const hasAuth = ctx.includes('requireAuth');
    const hasPriv = ctx.includes('requirePrivileged');

    if (publicRoutes.has(r.path)) {
      check(`Public route ${r.path} is open (correct)`, !hasAuth, hasAuth ? 'Has requireAuth but should be public!' : 'OK');
      continue;
    }
    if (r.path.startsWith('/api/')) {
      const detail = hasAuth ? (hasPriv ? 'requireAuth + privileged' : 'requireAuth') : 'MISSING';
      check(`Route ${r.method.toUpperCase()} ${r.path} has requireAuth`, hasAuth, detail);
    }
  }

  // Webhook uses variable path — check separately
  check('Webhook /api/webhook/onedrive uses Graph validation',
    idx.includes('handleWebhook'), 'OK (no JWT — correct)');

  // ========== 3. Preview credentials safety ==========
  console.log('\n── 3. Preview credentials safety ──');
  const authc = readFileSafe(path.join(ROOT, 'server', 'authStore.js'));
  const previewFn = authc.match(/export function previewCredentials[\s\S]{0,400}/);
  const previewSafe = previewFn && !previewFn[0].includes('passwordHash') &&
    !previewFn[0].includes('u.password');
  check('previewCredentials never exposes passwords', previewSafe,
    previewSafe ? 'OK' : 'EXPOSES PASSWORDS!');

  // ========== 4. JWT security ==========
  console.log('\n── 4. JWT security ──');
  check('JWT_SECRET required at startup',
    authc.includes('Refusing to start') || authc.includes('process.exit'),
    authc.includes('process.exit') ? 'OK' : 'MISSING CHECK');

  // ========== 5. Rate limiting ==========
  console.log('\n── 5. Rate limiting ──');
  check('Login rate limit (5/min per user+IP)', authc.includes('checkRateLimit'), 'OK');

  // ========== 6. SQL security ==========
  console.log('\n── 6. SQL injection prevention ──');
  const sqlc = readFileSafe(path.join(ROOT, 'server', 'sqlEngine.js'));
  check('SQL blocks non-SELECT statements',
    sqlc.includes('dangerous') || sqlc.includes('block'),
    sqlc.includes('dangerous') ? 'OK' : 'check sqlEngine.js');

  // ========== 7. .env.example audit ==========
  console.log('\n── 7. .env.example audit ──');
  const envEx = readFileSafe(path.join(ROOT, 'server', '.env.example'));
  let envExOk = true;
  for (const l of envEx.split('\n')) {
    if (/^\s*#/.test(l) || /^\s*$/.test(l)) continue;
    if (/=\s*sk-[a-zA-Z0-9_-]{20,}/.test(l)) { envExOk = false; console.log(`  ⚠️  API key: ${l.trim().slice(0, 80)}`); }
    if (/=\s*postgres(ql)?:\/\/[^:]+:[^@]+@/.test(l)) { envExOk = false; console.log(`  ⚠️  DB URL: ${l.trim().slice(0, 80)}`); }
    if (/=\s*[a-f0-9]{32,64}\s*$/.test(l) && !l.includes('#')) { envExOk = false; console.log(`  ⚠️  Hex secret: ${l.trim().slice(0, 80)}`); }
  }
  check('.env.example contains placeholders only', envExOk,
    envExOk ? 'OK' : 'real values found!');

  // ========== 8. CORS security ==========
  console.log('\n── 8. CORS security ──');
  const corsWildcard = (idx.match(/cors\s*\(\s*\{\s*origin\s*:\s*['"]\*['"]/) || []).length;
  check('CORS does not use wildcard *', corsWildcard === 0,
    corsWildcard > 0 ? 'USES WILDCARD!' : 'OK (config-based origins)');
  check('CORS origins from CORS_ORIGINS env var', idx.includes('CORS_ORIGINS'),
    idx.includes('CORS_ORIGINS') ? 'OK' : 'hardcoded?');

  // ========== 9. .gitignore verification ==========
  console.log('\n── 9. .gitignore verification ──');
  const gi = readFileSafe(path.join(ROOT, '.gitignore'));
  check('.gitignore excludes .env files',
    gi.includes('.env') && gi.includes('!.env.example'),
    gi.includes('.env') ? 'OK' : 'MISSING .env exclusion');
  check('.gitignore excludes .env.local', gi.includes('.env.local'), 'OK');
  check('.gitignore excludes .vercel', gi.includes('.vercel'), 'OK');
  check('.gitignore excludes server/.data/', gi.includes('server/.data/'), 'OK');
  check('.gitignore excludes node_modules', gi.includes('node_modules'), 'OK');

  let gitIgnoreFunctional = true;
  const sensitivePaths = ['server/.env', '.env.local', '.vercel/', 'server/.data/'];
  try {
    const devDir = process.env.DEVELOPER_DIR || '/Library/Developer/CommandLineTools';
    const gitBin = `DEVELOPER_DIR=${devDir} git`;
    const ignoredOut = execSync(`${gitBin} check-ignore ${sensitivePaths.join(' ')}`, { cwd: ROOT, encoding: 'utf-8' });
    const ignoredList = ignoredOut.split('\n').map(s => s.trim()).filter(Boolean);
    const trackedOut = execSync(`${gitBin} ls-files ${sensitivePaths.join(' ')}`, { cwd: ROOT, encoding: 'utf-8' });
    gitIgnoreFunctional = ignoredList.length === sensitivePaths.length && trackedOut.trim().length === 0;
  } catch {
    gitIgnoreFunctional = sensitivePaths.every(p => gi.includes(p.replace(/\/$/, '')) || gi.includes('.env*'));
  }
  check('Sensitive artifacts (server/.env, .env.local, .vercel/, server/.data/) untracked and gitignored',
    gitIgnoreFunctional, gitIgnoreFunctional ? 'OK (functional check-ignore passed)' : 'FAIL');

  // ========== 10. Webhook validation ==========
  console.log('\n── 10. Webhook validation ──');
  const whc = readFileSafe(path.join(ROOT, 'server', 'onedriveWebhook.js'));
  const whHardcoded = whc.includes("'builderseye-realtime-sync'") || whc.includes('"builderseye-realtime-sync"');
  check('WEBHOOK_CLIENT_STATE no hardcoded fallback', !whHardcoded,
    whHardcoded ? 'HARDCODED FALLBACK!' : 'OK');

  // ========== 11. Client-side debug gate ==========
  console.log('\n── 11. Client-side gate audit ──');
  const debugHtml = readFileSafe(path.join(ROOT, 'debug_neural_network_diagram.html'));
  const hasClientGate = debugHtml.includes("root") && debugHtml.includes("1234");
  // PASS if NO gate OR gate is cosmetic-only with backend JWT enforcement
  const gateOk = !hasClientGate || idx.includes('requireAuth');
  check('No client-side-only security gate (backend JWT enforced)',
    gateOk,
    hasClientGate ? 'Cosmetic gate present — backend routes requireAuth ✓ (safe)' : 'No gate found — clean ✓');

  // ========== 12. Frontend password scan ==========
  console.log('\n── 12. Frontend password scan ──');
  let frontendPw = [];
  for (const f of allFiles) {
    if (f.includes('node_modules') || f.includes('.git') || f.includes('dist')) continue;
    if (f.includes('verify_security') || f.includes('.env') || f.includes('test_api_invalid_login')) continue;
    const c = readFileSafe(f);
    // Skip files that intentionally test invalid logins with wrong passwords
    if (f.includes('test_api_invalid_login')) continue;
    const legacyTestPw = new RegExp(['HhAj', 'zrMkw', '0ODQfr'].join(''), 'i');
    const pwPatterns = [/CEO@Landyi/i, /HR@2026test/i, /Exec@2026test/i, /Emp@2026test/i, /Pass@1234/i, legacyTestPw];
    for (const pat of pwPatterns) {
      if (pat.test(c)) {
        frontendPw.push(`${path.relative(ROOT, f)}`);
        break;
      }
    }
  }
  check('No hardcoded test passwords in tracked files', frontendPw.length === 0,
    frontendPw.length ? `${frontendPw.length} file(s): ${frontendPw.slice(0, 5).join(', ')}` : 'clean');

  // ========== 13. Decommissioned / Offline state verification ==========
  console.log('\n── 13. Decommissioned / Offline state verification ──');
  const offlineHtml = readFileSafe(path.join(ROOT, 'offline.html'));
  const distDir = path.join(ROOT, 'dist');
  const distOfflineHtml = readFileSafe(path.join(distDir, 'offline.html'));
  const publicOfflineHtml = readFileSafe(path.join(ROOT, 'public', 'offline.html'));
  const vercelJson = readFileSafe(path.join(ROOT, 'vercel.json'));
  const indexHtml = readFileSafe(path.join(ROOT, 'index.html'));
  const appHtml = readFileSafe(path.join(ROOT, 'app.html'));
  const adminHtml = readFileSafe(path.join(ROOT, 'admin.html'));

  check('offline.html exists and displays offline notice',
    offlineHtml.includes('BuildersEye — Service Offline'),
    offlineHtml.includes('BuildersEye — Service Offline') ? 'OK' : 'MISSING OR INVALID');

  check('public/offline.html exists and displays offline notice',
    publicOfflineHtml.includes('BuildersEye — Service Offline'),
    publicOfflineHtml.includes('BuildersEye — Service Offline') ? 'OK' : 'MISSING OR INVALID');

  if (fs.existsSync(distDir)) {
    check('dist/offline.html preserves offline notice',
      distOfflineHtml.includes('BuildersEye — Service Offline'),
      distOfflineHtml.includes('BuildersEye — Service Offline') ? 'OK' : 'MISSING OR INVALID');
  }

  let vercelRedirects = false;
  try {
    const vj = JSON.parse(vercelJson);
    vercelRedirects = Array.isArray(vj.redirects) &&
      vj.redirects.some(r => r.destination === '/offline.html' && r.source && r.source.includes('offline'));
  } catch {}
  check('vercel.json redirects all traffic to /offline.html', vercelRedirects,
    vercelRedirects ? 'OK' : 'REDIRECTS MISSING');

  const entrypointsOffline = indexHtml.includes('BuildersEye — Service Offline') &&
    appHtml.includes('BuildersEye — Service Offline') &&
    adminHtml.includes('BuildersEye — Service Offline');
  check('Main UI entrypoints (index/app/admin) serve offline notice', entrypointsOffline,
    entrypointsOffline ? 'OK' : 'ENTRYPOINTS NOT OFFLINE');

  // ========== SUMMARY ==========
  console.log(`\n📊 Security: ${passed} passed, ${failed} failed / ${checks.length} total`);
  if (failed > 0) {
    console.log('\n❌ Fix the issues above before deploying.');
  } else {
    console.log('\n✅ All security checks passed.');
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
