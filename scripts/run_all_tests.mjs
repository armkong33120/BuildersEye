// run_all_tests.mjs — Test orchestrator
// Runs all deterministic API tests in sequence and reports results.
// Tests that require LLM are skipped gracefully if LLM is unavailable.
//
// Usage: node scripts/run_all_tests.mjs
// Env: BACKEND_URL (default http://localhost:5199)
//      TEST_USERNAME, TEST_PASSWORD (for authenticated tests)

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_SUITES = [
  { name: 'Invalid Login',        file: 'test_api_invalid_login.mjs',    requiresAuth: false },
  { name: 'Blocked Queries',      file: 'test_api_blocked_query.mjs',    requiresAuth: true },
  { name: 'Debug Auth',           file: 'test_api_debug_auth.mjs',       requiresAuth: true },
  { name: 'Session Refresh',      file: 'test_api_session_refresh.mjs',  requiresAuth: true },
  { name: 'Vector Query',         file: 'test_api_vector_query.mjs',     requiresAuth: true },
  { name: 'SQL Query',            file: 'test_api_sql_query.mjs',        requiresAuth: true },
  { name: 'Cache Hit',            file: 'test_api_cache.mjs',            requiresAuth: true },
  { name: 'SQL Fallback',         file: 'test_api_sql_fallback.mjs',     requiresAuth: true },
  { name: 'RBAC Matrix',          file: 'test_api_rbac_matrix.mjs',      requiresAuth: true },
];

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5199';
const HAS_AUTH = !!(process.env.TEST_USERNAME && process.env.TEST_PASSWORD);

const results = [];

function runTest(file) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, file);
    if (!fs.existsSync(scriptPath)) {
      resolve({ file, passed: false, exitCode: -1, detail: 'file not found' });
      return;
    }

    const child = spawn('node', [scriptPath], {
      env: { ...process.env, BACKEND_URL },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });

    let stdout = '', stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({
        file,
        passed: code === 0,
        exitCode: code,
        detail: code === 0 ? 'PASS' : `exit=${code}`,
        stderr: stderr.slice(0, 200),
      });
    });

    child.on('error', (err) => {
      resolve({ file, passed: false, exitCode: -2, detail: err.message });
    });
  });
}

async function main() {
  console.log('🧪 Run All Tests');
  console.log(`   Backend: ${BACKEND_URL}`);
  console.log(`   Auth configured: ${HAS_AUTH ? 'YES' : 'NO (auth tests will skip)'}`);
  console.log('');

  let totalPassed = 0, totalFailed = 0, totalSkipped = 0;

  for (const suite of TEST_SUITES) {
    if (suite.requiresAuth && !HAS_AUTH) {
      console.log(`⏭️  ${suite.name} — SKIPPED (no auth configured)`);
      totalSkipped++;
      continue;
    }

    console.log(`\n── ${suite.name} ──`);
    const result = await runTest(suite.file);
    results.push({ ...suite, ...result });

    if (result.passed) {
      totalPassed++;
      console.log(`  ✅ ${suite.name} PASSED`);
    } else {
      totalFailed++;
      console.log(`  ❌ ${suite.name} FAILED (${result.detail})`);
      if (result.stderr) console.log(`     stderr: ${result.stderr}`);
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log('📊 FINAL RESULTS');
  console.log('═══════════════════════════════════════');
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}: ${r.detail}`);
  }
  console.log('───────────────────────────────────────');
  console.log(`  Passed:  ${totalPassed}`);
  console.log(`  Failed:  ${totalFailed}`);
  console.log(`  Skipped: ${totalSkipped}`);
  console.log(`  Total:   ${totalPassed + totalFailed + totalSkipped}`);
  console.log('═══════════════════════════════════════');

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Orchestrator error:', e.message);
  process.exit(1);
});
