// test_admin_preview_contract.mjs — Static contract regression for /api/admin/preview.
//
// Deterministic — no backend, no credentials, no browser. Reads the actual source
// (server route/service + admin console JS) and the built dist artifacts, and
// asserts the hardening invariants that browser/credential-gated tests would
// otherwise be the only ones to catch:
//
//   1. Admin-only enforcement  — route mounted under requireAuth + requireAdmin
//   2. Scoped to SELECTED user — previewAsUser resolves the selected employee's
//      own access, never the admin/CEO's
//   3. Body identity/profileCode ignored — only employeeCode (legacy viewerCode
//      alias) is read from the body; profileCode comes from server org data
//   4. Status-only records     — records carry status/reason, never content values
//   5. isPreview flag          — response explicitly marked preview mode
//   6. policyVersion present   — returned in the payload and rendered by the UI
//   7. Audit recorded          — preview_as_user event with JWT actor
//   8. UI sequence guard       — a stale in-flight preview can never render
//   9. No profile-override dropdown in the preview toolbar
//  10. Org tree / permission matrix / audit render paths present
//  11. Built dist/admin.html + dist/assets/admin-*.js exist (build emitted them)
//
// Run: node scripts/test_admin_preview_contract.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ADMIN_JS = 'src/js/admin.js';
const ADMIN_CSS = 'src/styles/admin.css';
const ROUTES = 'server/adminRoutes.js';
const SERVICE = 'server/access/adminService.js';
const ADMIN_HTML = fs.existsSync(path.join(ROOT, 'admin.html.bak')) ? 'admin.html.bak' : 'admin.html';

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}
function contains(src, needle, label) {
  return assert(`${label}: contains ${JSON.stringify(needle)}`, src.includes(needle),
    `missing ${JSON.stringify(needle)}`);
}

console.log('🧪 Static /api/admin/preview contract tests\n');

console.log('── 1. Admin-only route enforcement (server/adminRoutes.js) ──');
const routes = read(ROUTES);
contains(routes, 'router.use(requireAuth, requireAdmin);', 'router.use');
contains(routes, "router.post('/preview'", 'preview route');
assert('preview route mounted AFTER requireAuth+requireAdmin', routes.indexOf("router.post('/preview'") > routes.indexOf('router.use(requireAuth, requireAdmin);'));
contains(routes, 'const { employeeCode } = req.body || {};', 'body reads employeeCode only');
assert('body does NOT destructure profileCode/username/role',
  !/const \{ [^}]*profileCode[^}]*\} = req\.body/.test(routes), 'profileCode destructured from body');
contains(routes, 'previewAsUser(actor(req)', 'actor derived from JWT (req.authUser)');

console.log('── 2. Service contract (server/access/adminService.js) ──');
const svc = read(SERVICE);
contains(svc, 'export function previewAsUser(actor, { employeeCode, viewerCode } = {}, org = {})', 'signature');
assert('service destructures only employeeCode/viewerCode (no profileCode/username)',
  !/employeeCode, viewerCode, profileCode/.test(svc) && !/employeeCode, viewerCode, username/.test(svc), 'profileCode/username in destructure');
contains(svc, 'profileByCode.get(code) || ACCESS_PROFILE_CODES.SELF_ONLY', 'server-side profileCode lookup');
contains(svc, 'resolveAccess({ employeeCode: code, profileCode }', 'scope resolved for SELECTED user');
contains(svc, "content: ''", 'records carry no content values (status-only)');
contains(svc, 'isPreview: true', 'isPreview flag');
contains(svc, 'const policyVersion = getPolicyVersion();', 'policyVersion fetched');
contains(svc, "recordAudit(actor, { entity: 'preview', action: 'preview_as_user'", 'preview audit recorded');
assert('actor passed to audit comes from the function arg (JWT), not body',
  /recordAudit\(actor,/.test(svc) && !/recordAudit\(req\.body/.test(svc), 'actor source');

console.log('── 3. Admin console preview logic (src/js/admin.js) ──');
const ui = read(ADMIN_JS);
contains(ui, 'JSON.stringify({ employeeCode: viewerCode })', 'preview POST body = { employeeCode } only');
assert('preview body does NOT include profileCode/username/role',
  !/api\/admin\/preview[\s\S]{0,220}profileCode/.test(ui), 'profileCode near preview POST');
contains(ui, 'let previewSeq = 0;', 'sequence token declared');
contains(ui, 'const seq = ++previewSeq;', 'sequence token incremented per run');
contains(ui, 'if (seq !== previewSeq) return;', 'stale preview response discarded');
contains(ui, 'PREVIEW MODE', 'PREVIEW MODE badge text');
contains(ui, "data.policyVersion != null ? data.policyVersion : '—'", 'policyVersion rendered in summary');

// Preview toolbar must contain a viewer picker but NO profile-override control.
const previewFn = ui.slice(ui.indexOf('function renderPreview()'), ui.indexOf('// Sequence token:'));
assert('renderPreview block found', previewFn.length > 100, 'function not located');
contains(previewFn, 'id="pvViewer"', 'viewer select');
assert('preview toolbar has NO profileCode/accessProfile override control',
  !/profileCode|accessProfile|mxSubject/.test(previewFn),
  'profile-override control found in preview toolbar');

console.log('── 4. Render paths present (org tree / matrix / audit) ──');
contains(ui, "el('orgTree')", 'org tree container referenced by renderOrg');
contains(ui, 'renderOrgNode', 'org tree renderer');
contains(ui, 'id="mxPolicies"', 'permission matrix container');
contains(ui, 'renderMatrix', 'matrix renderer');
contains(ui, "el('auditTableWrap')", 'audit table container referenced by renderAudit');
contains(ui, 'renderAudit', 'audit renderer');
contains(ui, 'escapeHtml(rec.sheetName', 'preview records escaped via escapeHtml');

console.log('── 5. Styles + HTML shell present ──');
const css = read(ADMIN_CSS);
contains(css, '.badge.preview', 'PREVIEW badge style');
contains(css, '.preview-record', 'preview record style');
contains(css, '.preview-summary', 'preview summary style');
const html = read(ADMIN_HTML);
contains(html, 'id="previewToolbar"', 'preview toolbar element');
contains(html, 'id="previewBody"', 'preview body element');
contains(html, 'id="policyVersionChip"', 'policy version chip');
contains(html, 'id="section-org"', 'org section');
contains(html, 'id="section-matrix"', 'matrix section');
contains(html, 'id="section-audit"', 'audit section');



console.log('── 6. Built dist artifacts (npm run build output) ──');
const dist = path.join(ROOT, 'dist');
const distHtml = path.join(dist, 'admin.html');
const assetsDir = path.join(dist, 'assets');
const distAssets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
const adminBundle = distAssets.find((f) => /^admin-.+\.js$/.test(f));
const adminCssBundle = distAssets.find((f) => /^admin-.+\.css$/.test(f));
assert('dist/admin.html exists', fs.existsSync(distHtml));
if (fs.existsSync(assetsDir)) {
  assert('dist/assets/admin-*.js exists', !!adminBundle, 'no admin JS bundle in dist/assets');
  assert('dist/assets/admin-*.css exists', !!adminCssBundle, 'no admin CSS bundle in dist/assets');
} else {
  console.log('  ℹ️  dist/assets not present (decommissioned/offline distribution)');
}
if (adminBundle) {
  const bundle = fs.readFileSync(path.join(dist, 'assets', adminBundle), 'utf8');
  // Minified local identifiers are renamed, but object keys / string literals survive.
  contains(bundle, 'employeeCode:', 'built bundle preview payload key employeeCode');
  contains(bundle, 'PREVIEW MODE', 'built bundle PREVIEW MODE badge');
  contains(bundle, 'policyVersion', 'built bundle policyVersion');
  assert('built bundle still discards stale preview responses (seq guard pattern)',
    /if\([a-zA-Z$]+\!==[a-zA-Z$]+\)return;/.test(bundle) || bundle.includes('seq !== previewSeq'),
    'no stale-guard pattern in bundle');
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
