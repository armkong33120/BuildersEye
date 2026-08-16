// test_isolation_security.mjs — Regression: cross-user isolation (H1/H2/H3, M3, cache).
//
// Unit-level tests (no live backend / no auth needed) covering:
//   1. Conversation ownership  — user A cannot list/read/delete/append user B's conv
//   2. Chat-memory partitioning — user A history cannot leak into user B via a shared id
//   3. Response-cache         — cross-user keys differ; policy-version bump invalidates
//   4. Admin "Preview As User" — scoped to the SELECTED user (never the CEO), marked
//      preview, logs audit; manager scope stays restricted
//
// Uses a temp ACCESS_DATA_DIR so it never touches real runtime access data. The
// conversation store is file-backed under server/.data/conversations — tests use
// unique ids and clean up after themselves.
//
// Usage: node scripts/test_isolation_security.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'be-isolation-'));
process.env.ACCESS_DATA_DIR = TMP;

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail || ''}`); }
}

const uniqueId = (p) => `${p}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

async function main() {
  // ── Dynamic import-batch (so ACCESS_DATA_DIR applies to access-store modules) ──
  const convStore = await import('../server/conversationStore.js');
  const chatMem = await import('../server/chatMemory.js');
  const pronoun = await import('../server/pronounResolver.js');
  const rcache = await import('../server/responseCache.js');
  const acc = await import('../server/access/index.js');

  console.log('🧪 Cross-user isolation tests\n');

  // ── 1. Conversation ownership (H2) ────────────────────────────────────────
  console.log('── 1. Conversation ownership ──');
  const convoId = uniqueId('iso-conv');
  const saved = convStore.addMessage(convoId, 'user', 'hello from A', null, 1);
  assert('A creates conversation (owner recorded)', saved && saved.owner === 1, `owner=${saved?.owner}`);

  // list: B must not see A's conversation
  const listA = convStore.listConversations(1);
  const listB = convStore.listConversations(2);
  assert('B cannot LIST A\'s conversation', listA.some(c => c.id === convoId) === true && listB.some(c => c.id === convoId) === false);

  // read: B cannot read → null (map to 404)
  assert('B cannot READ A\'s conversation', convStore.getConversation(convoId, 2) === null);
  assert('A can READ own conversation', convStore.getConversation(convoId, 1) !== null);

  // append: B cannot append (reuse A's id) → 403
  let appendErr = null;
  try { convStore.addMessage(convoId, 'user', 'evil', null, 2); } catch (e) { appendErr = e; }
  assert('B cannot APPEND to A\'s conversation (403)', appendErr && appendErr.status === 403, appendErr?.message);

  // delete: B cannot delete A's conversation
  assert('B cannot DELETE A\'s conversation', convStore.deleteConversation(convoId, 2) === false);
  assert('A\'s conversation still exists after B delete attempt', convStore.getConversation(convoId, 1) !== null);
  assert('A can DELETE own conversation', convStore.deleteConversation(convoId, 1) === true);
// ── 2. Chat-memory partition (H3) ────────────────────────────────────────
  console.log('── 2. Chat-memory partition ──');
  const sharedId = uniqueId('shared');
  chatMem.addMessage(1, sharedId, 'user', 'EMP001 เงินเดือนเท่าไหร่');
  chatMem.addMessage(1, sharedId, 'assistant', 'EMP001 (คือ EMP001) มีเงินเดือน 50000');
  chatMem.addMessage(2, sharedId, 'user', 'สวัสดี');

  const histA = chatMem.getHistory(1, sharedId);
  const histB = chatMem.getHistory(2, sharedId);
  assert('A history contains A messages', histA.length === 2);
  assert('B history does NOT leak A messages via shared id', histB.length === 1 && histB[0].content === 'สวัสดี');

  const resolvedB = pronoun.resolvePronouns('แล้วล่ะ', 2, sharedId);
  assert('Pronoun resolution for B does NOT use A history', resolvedB.resolved === false || !resolvedB.ref,
    `resolved=${JSON.stringify(resolvedB)}`);

  chatMem.clearHistory(1, sharedId);
  chatMem.clearHistory(2, sharedId);

  // ── 3. Response-cache isolation (M4 + cross-user) ─────────────────────────
  console.log('── 3. Response-cache isolation ──');
  const q = 'CEO ยอดขายรวม';
  const keyA = rcache.cacheKeyFor(q, { role: 'CEO', employeeId: 1 });
  const keyB = rcache.cacheKeyFor(q, { role: 'Manager', employeeId: 2 });
  assert('cache keys differ per user (role+id)', keyA !== keyB, `A=${keyA} B=${keyB}`);

  rcache.cacheSet(keyA, { answer: 'A-private', retrievalEvidence: ['secret-A'] });
  const bHit = rcache.cacheGet(keyB);
  assert('user B cannot read user A cached response (different key → miss)', bHit === null);
  const aHit = rcache.cacheGet(keyA);
  assert('user A can read own cached response', aHit !== null && aHit.answer === 'A-private');

  // policy version bump invalidates (key changes) → no stale cross-policy hit
  const versionBefore = acc.getPolicyVersion();
  acc.bumpPolicyVersion();
  const keyA2 = rcache.cacheKeyFor(q, { role: 'CEO', employeeId: 1 });
  assert('policy-version bump changes the cache key', keyA2 !== keyA);
  assert('stale cache cannot be read by new key after policy bump', rcache.cacheGet(keyA2) === null);
  assert('policy version bumped', acc.getPolicyVersion() > versionBefore);
// ── 4. Admin Preview As User (M3) ─────────────────────────────────────────
  console.log('── 4. Admin Preview As User ──');
  acc.seedAccessModel({
    employees: [
      { code: 'EMP001', pk: 1, name: 'CEO', jobTitle: 'CEO', roleGroup: 'CEO', department: 'Executive', managerCode: '', status: 'active' },
      { code: 'EMP002', pk: 2, name: 'Mgr', jobTitle: 'Manager', department: 'Sales', managerCode: 'EMP001', status: 'active' },
      { code: 'EMP003', pk: 3, name: 'EmpA', jobTitle: 'Staff', department: 'Sales', managerCode: 'EMP002', status: 'active' },
      { code: 'EMP004', pk: 4, name: 'EmpB', jobTitle: 'Staff', department: 'Sales', managerCode: 'EMP002', status: 'active' },
      { code: 'EMP005', pk: 5, name: 'HR', jobTitle: 'HR Manager', department: 'HR & Admin', managerCode: 'EMP001', status: 'active' },
    ],
  });
  const org = {
    employees: acc.getEmployees(),
    relationships: acc.getRelationships(),
    profiles: acc.getProfilesMap(),
  };
  const adminActor = { username: 'ceo', employeeId: 1, role: 'CEO' };

  const previewEmp = acc.adminService.previewAsUser(adminActor, { employeeCode: 'EMP003' }, org);
  assert('preview marked isPreview:true', previewEmp.isPreview === true);
  assert('previewUser is the SELECTED employee', previewEmp.previewUser.employeeCode === 'EMP003');
  assert('preview is NOT the admin/CEO profile', !!previewEmp.accessProfile && previewEmp.accessProfile.profileCode !== acc.ACCESS_PROFILE_CODES.GLOBAL_ADMIN);
  assert('preview scope is SELF_ONLY for an employee', previewEmp.scope === 'SELF', `scope=${previewEmp.scope}`);
  assert('preview blocks sensitive fields', previewEmp.markers.some(m => m.field === 'Base_Salary' && m.status === 'blocked'));
  assert('preview carries policyVersion', typeof previewEmp.policyVersion === 'number');
  assert('preview for employee NOT rendered at admin/CEO scope', previewEmp.scope === 'SELF');

  // Body-provided identity/profileCode must NEVER change the preview subject:
  // the profile always comes from the server-side org data.
  const spoofed = acc.adminService.previewAsUser(adminActor, { employeeCode: 'EMP003', profileCode: acc.ACCESS_PROFILE_CODES.GLOBAL_ADMIN, username: 'attacker' }, org);
  assert('preview IGNORES body profileCode override (stays SELF)', spoofed.scope === 'SELF' && spoofed.accessProfile.profileCode !== acc.ACCESS_PROFILE_CODES.GLOBAL_ADMIN);
  assert('preview IGNORES body username (actor from JWT)', spoofed.previewUser.employeeCode === 'EMP003');

  // UI contract: viewer + records shapes present; records carry status ONLY —
  // never real content values.
  assert('preview returns UI viewer shape', !!previewEmp.viewer && previewEmp.viewer.employeeCode === 'EMP003' && previewEmp.viewer.scope === 'SELF');
  assert('preview returns records array', Array.isArray(previewEmp.records) && previewEmp.records.length === previewEmp.markers.length);
  assert('preview records carry status only (no content values)',
    previewEmp.records.every((r) => r.content === '' && ['visible', 'redacted', 'blocked'].includes(r.status)),
    JSON.stringify(previewEmp.records.slice(0, 2)));

  // Manager preview — scope must remain SUBTREE, never elevated to ALL/CEO scope
  const previewMgr = acc.adminService.previewAsUser(adminActor, { employeeCode: 'EMP002' }, org);
  assert('manager preview scope is SUBTREE', previewMgr.scope === 'SUBTREE');
  const mgrScope = new Set(previewMgr.scopeCodesPreview || []);
  assert('manager subtree includes direct report (EMP003)', mgrScope.has('EMP003'));
  assert('manager subtree does NOT include out-of-scope employee (EMP005)', !mgrScope.has('EMP005'));

  // HR preview — HR_PRIVILEGED has ALL scope but still may be field-redacted
  const previewHr = acc.adminService.previewAsUser(adminActor, { employeeCode: 'EMP005' }, org);
  assert('HR preview scope is ALL', previewHr.scope === 'ALL');

  // Preview is audited with an actor-sourced identity
  const audits = acc.listAudit({ limit: 20, entity: 'preview' });
  assert('preview audit recorded in audit log', audits.length >= 1);
  assert('preview audit actor comes from JWT (not body)', audits[0].actor.username === 'ceo');

  // ── cleanup ───────────────────────────────────────────────────────────────
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Test harness error:', e); process.exit(1); });