// admin.js — CEO Admin Configuration Console.
//
// Consumes the /api/admin/* contract implemented by backend-security
// (server/adminRoutes.js + server/access/adminService.js). The backend is the
// source of truth: role/employeeId/permissions are NEVER read from the client —
// every request is authorized by the signed JWT, and the actor recorded in audit
// events comes from the JWT, not from any form field.
//
// SECURITY: this console never renders secrets/passwords/tokens. It only shows
// configuration state returned by the admin API.

// ── Backend URL (same resolution as src/main.js) ──────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const RAG_BACKEND = urlParams.get('backend')
  || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_RAG_BACKEND)
  || 'http://localhost:5199';

// ── Small utilities ───────────────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function el(id) { return document.getElementById(id); }

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return escapeHtml(iso);
  return d.toLocaleString();
}

// ── Session (JWT stored in localStorage, shared with app.html) ────────────────
function getAccessToken() { try { return localStorage.getItem('be_access') || ''; } catch (e) { return ''; } }
function getRefreshToken() { try { return localStorage.getItem('be_refresh') || ''; } catch (e) { return ''; } }
function setSession(access, refresh, user) {
  try {
    if (access) localStorage.setItem('be_access', access);
    if (refresh) localStorage.setItem('be_refresh', refresh);
    if (user) localStorage.setItem('be_user', JSON.stringify(user));
  } catch (e) { /* ignore */ }
}
function clearSession() {
  try {
    localStorage.removeItem('be_access');
    localStorage.removeItem('be_refresh');
    localStorage.removeItem('be_user');
  } catch (e) { /* ignore */ }
}
function getSessionUser() {
  try { return JSON.parse(localStorage.getItem('be_user') || 'null'); } catch (e) { return null; }
}

function authHeaders() {
  const token = getAccessToken();
  return token
    ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function refreshSession() {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const res = await fetch(RAG_BACKEND + '/api/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setSession(data.accessToken, data.refreshToken, data.user);
    return true;
  } catch (e) { return false; }
}

// fetch wrapper: on 401 → try refresh once → retry; else show login.
async function apiFetch(url, options, retried) {
  const opts = options || {};
  opts.headers = Object.assign({}, authHeaders(), opts.headers || {});
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    return { _networkError: true, ok: false, status: 0, error: 'Network error — backend unreachable' };
  }
  if (res.status === 401 && !retried) {
    const ok = await refreshSession();
    if (ok) return apiFetch(url, options, true);
    clearSession();
    showLoginOverlay('Session expired — please sign in again');
  }
  return res;
}

// Parse a response as JSON, returning { ok, status, data, error }.
async function apiJson(url, options) {
  const res = await apiFetch(url, options);
  if (res._networkError) return { ok: false, status: 0, error: res.error };
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    return { ok: false, status: res.status, error: (data && data.error) || ('HTTP ' + res.status) };
  }
  return { ok: true, status: res.status, data };
}

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  me: null,
  employees: [],
  relationships: [],
  profiles: [],
  policies: [],
  sourceLinks: [],
  audit: [],
  policyVersion: null,
  loaded: {},
};

// ── Login overlay ─────────────────────────────────────────────────────────────
function showLoginOverlay(msg) {
  const ov = el('adminLoginOverlay');
  if (!ov) return;
  ov.classList.remove('is-hidden');
  const err = el('adminLoginError');
  if (err) err.textContent = msg || '';
  setTimeout(() => { const u = el('adminLoginUsername'); if (u) u.focus(); }, 60);
}
function hideLoginOverlay() {
  const ov = el('adminLoginOverlay');
  if (ov) ov.classList.add('is-hidden');
}

async function doLogin(username, password) {
  const err = el('adminLoginError');
  const btn = el('adminLoginSubmit');
  if (err) err.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  try {
    const res = await fetch(RAG_BACKEND + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (err) err.textContent = data.error || ('Sign-in failed (' + res.status + ')');
      return;
    }
    setSession(data.accessToken, data.refreshToken, data.user);
    await boot();
  } catch (e) {
    if (err) err.textContent = 'Network error — backend unreachable';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
  }
}

async function doLogout() {
  try {
    const rt = getRefreshToken();
    await fetch(RAG_BACKEND + '/api/auth/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
  } catch (e) { /* ignore */ }
  clearSession();
  state.me = null;
  renderUserChip();
  showLoginOverlay('Signed out');
}

function renderUserChip() {
  const chip = el('adminUserChip');
  if (!chip) return;
  const u = state.me || getSessionUser();
  if (!u) { chip.classList.add('is-hidden'); return; }
  const role = u.role || '—';
  chip.innerHTML =
    '<span class="dot"></span>' +
    '<span>' + escapeHtml(u.name || u.username || '') + '</span>' +
    '<span style="color:var(--muted)">· ' + escapeHtml(role) + '</span>';
  chip.classList.remove('is-hidden');
}

// ── Boot / auth gate ──────────────────────────────────────────────────────────
async function boot() {
  hideLoginOverlay();
  // Verify the session and confirm admin authorization by attempting a read.
  const me = await apiJson(RAG_BACKEND + '/api/auth/me');
  if (me.ok) {
    state.me = me.data;
    setSession(null, null, me.data);
  }
  renderUserChip();

  const probe = await apiJson(RAG_BACKEND + '/api/admin/profiles');
  if (probe.status === 401) {
    clearSession();
    state.me = null;
    renderUserChip();
    showLoginOverlay('Please sign in');
    return;
  }
  if (probe.status === 403) {
    // Authenticated but not an admin.
    showForbidden();
    return;
  }
  if (!probe.ok) {
    showForbidden('Unable to reach the admin API: ' + (probe.error || 'unknown error'));
    return;
  }
  await loadAll();
}

function showForbidden(msg) {
  const content = el('adminContent');
  if (content) {
    content.innerHTML = '<div class="state-box error">' +
      escapeHtml(msg || 'Forbidden: admin access only. Your account does not have the GLOBAL_ADMIN profile.') +
      '</div>';
  }
  renderUserChip();
}

// ── Navigation ────────────────────────────────────────────────────────────────
const SECTION_TITLES = {
  org: 'Organization Tree',
  sources: 'Data Sources',
  matrix: 'Permission Matrix',
  preview: 'Preview As User',
  audit: 'Audit & History',
};

function switchSection(name) {
  document.querySelectorAll('.admin-nav-item').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.section === name);
  });
  document.querySelectorAll('.admin-section').forEach((s) => {
    s.classList.toggle('is-active', s.dataset.sectionPanel === name);
  });
  const title = el('adminTopbarTitle');
  if (title) title.textContent = SECTION_TITLES[name] || name;
  // Lazy-load the section on first visit.
  if (!state.loaded[name]) loadSection(name);
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadAll() {
  await Promise.all([
    loadEmployees(), loadRelationships(), loadProfiles(), loadPolicies(),
    loadSourceLinks(), loadAudit(), loadPolicyVersion(),
  ]);
  // Render the default section (org) and any already-visited section.
  switchSection('org');
}

async function loadEmployees() {
  const r = await apiJson(RAG_BACKEND + '/api/admin/employees');
  if (r.ok) state.employees = r.data || [];
  return r;
}
async function loadRelationships() {
  const r = await apiJson(RAG_BACKEND + '/api/admin/relationships');
  if (r.ok) state.relationships = r.data || [];
  return r;
}
async function loadProfiles() {
  const r = await apiJson(RAG_BACKEND + '/api/admin/profiles');
  if (r.ok) state.profiles = r.data || [];
  return r;
}
async function loadPolicies() {
  const r = await apiJson(RAG_BACKEND + '/api/admin/policies');
  if (r.ok) state.policies = r.data || [];
  return r;
}
async function loadSourceLinks() {
  const r = await apiJson(RAG_BACKEND + '/api/admin/source-links');
  if (r.ok) state.sourceLinks = r.data || [];
  return r;
}
async function loadAudit(entity) {
  const q = entity ? ('?entity=' + encodeURIComponent(entity)) : '';
  const r = await apiJson(RAG_BACKEND + '/api/admin/audit' + q);
  if (r.ok) state.audit = r.data || [];
  return r;
}
async function loadPolicyVersion() {
  const r = await apiJson(RAG_BACKEND + '/api/admin/policy-version');
  if (r.ok) {
    state.policyVersion = r.data.version;
    const chip = el('policyVersionChip');
    if (chip) chip.textContent = 'Policy v' + state.policyVersion;
  }
  return r;
}

function loadSection(name) {
  state.loaded[name] = true;
  if (name === 'org') renderOrg();
  else if (name === 'sources') renderSources();
  else if (name === 'matrix') renderMatrix();
  else if (name === 'preview') renderPreview();
  else if (name === 'audit') renderAudit();
}

// ── Org snapshot helpers (mirror scopeResolver.buildOrgSnapshot semantics) ─────
function buildOrgSnapshot() {
  const byCode = new Map();
  for (const e of state.employees) {
    const code = String(e.employeeCode || '').trim().toUpperCase();
    if (!code) continue;
    byCode.set(code, e);
  }
  // managerOf: child -> manager (relationships win, fallback to employee.managerCode)
  const managerOf = new Map();
  for (const r of state.relationships) {
    const child = String(r.employeeCode || '').trim().toUpperCase();
    const mgr = String(r.managerCode || '').trim().toUpperCase();
    if (child && mgr) managerOf.set(child, mgr);
  }
  for (const e of state.employees) {
    const code = String(e.employeeCode || '').trim().toUpperCase();
    if (!code || managerOf.has(code)) continue;
    const mgr = String(e.managerCode || '').trim().toUpperCase();
    if (mgr) managerOf.set(code, mgr);
  }
  // childrenOf: manager -> [children]
  const childrenOf = new Map();
  for (const [child, mgr] of managerOf.entries()) {
    if (!childrenOf.has(mgr)) childrenOf.set(mgr, []);
    childrenOf.get(mgr).push(child);
  }
  // roots: active employees with no manager, or manager not in byCode
  const roots = [];
  for (const code of byCode.keys()) {
    const mgr = managerOf.get(code);
    if (!mgr || !byCode.has(mgr)) roots.push(code);
  }
  return { byCode, managerOf, childrenOf, roots };
}

function isActive(emp) {
  const s = String(emp.status || 'active').toLowerCase();
  return s !== 'deactivated' && s !== 'inactive' && s !== 'terminated' && s !== 'removed';
}

// Compute depth by walking the manager chain (with cycle detection).
function computeDepth(code, snapshot) {
  const seen = new Set();
  let cur = code;
  let depth = 0;
  while (cur) {
    if (seen.has(cur)) return { depth, cycle: true };
    seen.add(cur);
    const mgr = snapshot.managerOf.get(cur);
    if (!mgr || !snapshot.byCode.has(mgr)) break;
    cur = mgr;
    depth++;
    if (depth > 100) return { depth, cycle: true };
  }
  return { depth, cycle: false };
}

function subtreeCount(code, snapshot) {
  const seen = new Set();
  const queue = [code];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const child of snapshot.childrenOf.get(cur) || []) queue.push(child);
  }
  return seen.size - 1; // exclude self
}

// Level label from depth (C-Level / Manager / Lead / Junior / Staff).
function levelForDepth(depth) {
  if (depth <= 1) return { label: 'C-Level', cls: 'lvl-c' };
  if (depth === 2) return { label: 'Manager', cls: 'lvl-m' };
  if (depth === 3) return { label: 'Lead', cls: 'lvl-l' };
  if (depth === 4) return { label: 'Junior', cls: 'lvl-j' };
  return { label: 'Staff', cls: 'lvl-s' };
}

// ── Section 1: Organization Tree ──────────────────────────────────────────────
let orgSnapshot = null;
const orgCollapsed = new Set();

function renderOrg() {
  const wrap = el('orgTree');
  if (!wrap) return;
  if (!state.employees.length) {
    wrap.innerHTML = '<div class="state-box">No employees loaded. Try Refresh.</div>';
    return;
  }
  orgSnapshot = buildOrgSnapshot();
  const roots = orgSnapshot.roots.length
    ? orgSnapshot.roots
    : [...orgSnapshot.byCode.keys()];

  // Detect invalid managers (managerCode points at a non-existent employee).
  const invalidManagers = [];
  for (const [child, mgr] of orgSnapshot.managerOf.entries()) {
    if (mgr && !orgSnapshot.byCode.has(mgr)) invalidManagers.push({ child, mgr });
  }

  let html = '';
  if (invalidManagers.length) {
    html += '<div class="state-box error" style="margin-bottom:12px">' +
      '<strong>Invalid manager references detected:</strong> ' +
      invalidManagers.map((x) => escapeHtml(x.child) + ' → missing manager ' + escapeHtml(x.mgr)).join('; ') +
      '</div>';
  }
  if (!roots.length) {
    html += '<div class="state-box">Empty organization — no employees.</div>';
  } else {
    for (const root of roots) {
      html += renderOrgNode(root, 0);
    }
  }
  wrap.innerHTML = html;
}

function renderOrgNode(code, depth) {
  const emp = orgSnapshot.byCode.get(code);
  if (!emp) return '';
  const { depth: d, cycle } = computeDepth(code, orgSnapshot);
  const level = levelForDepth(d);
  const children = orgSnapshot.childrenOf.get(code) || [];
  const direct = children.length;
  const sub = subtreeCount(code, orgSnapshot);
  const active = isActive(emp);
  const collapsed = orgCollapsed.has(code);
  const hasChildren = children.length > 0;

  let html = '<div class="org-node" data-node="' + escapeHtml(code) + '">';
  html += '<div class="org-node-row">';
  html += '<button class="org-toggle' + (hasChildren ? '' : ' leaf') + '" data-action="toggle" data-code="' + escapeHtml(code) + '" type="button" aria-label="Toggle">' +
    (hasChildren ? (collapsed ? '▸' : '▾') : '·') + '</button>';
  html += '<span class="org-level ' + level.cls + '">' + level.label + '</span>';
  html += '<div class="org-node-main">';
  html += '<div class="org-node-name">' + escapeHtml(emp.name || '') +
    ' <span style="color:var(--muted);font-weight:400">(' + escapeHtml(code) + ')</span>' +
    (active ? '' : ' <span class="badge deactivated">deactivated</span>') +
    (cycle ? ' <span class="org-cycle-flag">⚠ cycle</span>' : '') +
    '</div>';
  html += '<div class="org-node-meta">' +
    escapeHtml(emp.department || '—') + ' · ' + escapeHtml(emp.jobTitle || '—') +
    ' · <span class="badge profile">' + escapeHtml(emp.accessProfile || '—') + '</span>' +
    ' · ' + direct + ' direct · ' + sub + ' in subtree' +
    '</div>';
  html += '</div>';
  html += '<div class="org-node-actions">';
  html += '<button class="btn btn-ghost" data-action="change-manager" data-code="' + escapeHtml(code) + '" type="button">Change manager</button>';
  html += '<button class="btn btn-ghost" data-action="move-dept" data-code="' + escapeHtml(code) + '" type="button">Move dept</button>';
  html += active
    ? '<button class="btn btn-danger" data-action="deactivate" data-code="' + escapeHtml(code) + '" type="button">Deactivate</button>'
    : '<button class="btn btn-ghost" data-action="activate" data-code="' + escapeHtml(code) + '" type="button">Activate</button>';
  html += '</div>';
  html += '</div>';

  if (hasChildren) {
    html += '<div class="org-children' + (collapsed ? ' is-collapsed' : '') + '">';
    for (const child of children) html += renderOrgNode(child, depth + 1);
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// ── Modal helper ──────────────────────────────────────────────────────────────
function openModal({ title, body, submitLabel = 'Save', onSubmit }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML =
    '<div class="modal-card">' +
    '<h3>' + escapeHtml(title) + '</h3>' +
    '<form class="modal-form">' + body +
    '<div class="modal-error" role="alert"></div>' +
    '<div class="modal-actions">' +
    '<button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
    '<button type="submit" class="btn btn-primary">' + escapeHtml(submitLabel) + '</button>' +
    '</div></form></div>';
  document.body.appendChild(backdrop);

  const form = backdrop.querySelector('form');
  const errEl = backdrop.querySelector('.modal-error');
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-close]').addEventListener('click', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type=submit]');
    const fd = new FormData(form);
    const values = {};
    for (const [k, v] of fd.entries()) values[k] = String(v).trim();
    submitBtn.disabled = true;
    errEl.textContent = '';
    try {
      const result = await onSubmit(values, errEl);
      if (result === false) { submitBtn.disabled = false; return; }
      close();
    } catch (err) {
      errEl.textContent = err.message || 'Unexpected error';
      submitBtn.disabled = false;
    }
  });
}

function employeeOptions(selectedCode, { includeEmpty = true } = {}) {
  const opts = state.employees
    .slice()
    .sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode)))
    .map((e) => {
      const code = String(e.employeeCode || '');
      const label = code + ' — ' + (e.name || '');
      return '<option value="' + escapeHtml(code) + '"' + (code === selectedCode ? ' selected' : '') + '>' +
        escapeHtml(label) + '</option>';
    })
    .join('');
  return (includeEmpty ? '<option value="">— none —</option>' : '') + opts;
}

// ── Org actions ───────────────────────────────────────────────────────────────
async function changeManager(code) {
  const emp = orgSnapshot.byCode.get(code);
  const currentMgr = orgSnapshot.managerOf.get(code) || '';
  openModal({
    title: 'Change manager — ' + code,
    submitLabel: 'Save manager',
    body:
      '<label class="field"><span>Employee</span><input value="' + escapeHtml(code) + ' — ' + escapeHtml(emp?.name || '') + '" disabled /></label>' +
      '<label class="field"><span>New manager</span><select name="managerCode">' + employeeOptions(currentMgr) + '</select></label>' +
      '<div class="section-hint" style="margin:0">Setting a manager that creates a cycle or references an unknown employee is rejected by the backend.</div>',
    onSubmit: async (values, errEl) => {
      const r = await apiJson(RAG_BACKEND + '/api/admin/relationships/' + encodeURIComponent(code) + '/manager', {
        method: 'PUT',
        body: JSON.stringify({ managerCode: values.managerCode || null }),
      });
      if (!r.ok) { errEl.textContent = r.error || 'Failed'; return false; }
      await refreshOrg();
      return true;
    },
  });
}

async function moveDept(code) {
  const emp = orgSnapshot.byCode.get(code);
  openModal({
    title: 'Move department — ' + code,
    submitLabel: 'Move',
    body:
      '<label class="field"><span>Employee</span><input value="' + escapeHtml(code) + ' — ' + escapeHtml(emp?.name || '') + '" disabled /></label>' +
      '<label class="field"><span>New department</span><input name="department" value="' + escapeHtml(emp?.department || '') + '" /></label>',
    onSubmit: async (values, errEl) => {
      if (!values.department) { errEl.textContent = 'Department is required'; return false; }
      const r = await apiJson(RAG_BACKEND + '/api/admin/employees/' + encodeURIComponent(code), {
        method: 'PUT',
        body: JSON.stringify({ department: values.department }),
      });
      if (!r.ok) { errEl.textContent = r.error || 'Failed'; return false; }
      await refreshOrg();
      return true;
    },
  });
}

async function addEmployee() {
  openModal({
    title: 'Add employee',
    submitLabel: 'Add employee',
    body:
      '<label class="field"><span>Employee code (stable ID)</span><input name="employeeCode" placeholder="EMP150" /></label>' +
      '<label class="field"><span>Name</span><input name="name" /></label>' +
      '<label class="field"><span>Department</span><input name="department" /></label>' +
      '<label class="field"><span>Job title</span><input name="jobTitle" /></label>' +
      '<label class="field"><span>Manager</span><select name="managerCode">' + employeeOptions('') + '</select></label>' +
      '<label class="field"><span>Access profile</span><select name="accessProfile">' +
        state.profiles.map((p) => '<option value="' + escapeHtml(p.profileCode) + '">' + escapeHtml(p.profileCode) + ' — ' + escapeHtml(p.label || '') + '</option>').join('') +
        '</select></label>',
    onSubmit: async (values, errEl) => {
      if (!values.employeeCode || !values.name) { errEl.textContent = 'Employee code and name are required'; return false; }
      const r = await apiJson(RAG_BACKEND + '/api/admin/employees', {
        method: 'POST',
        body: JSON.stringify({
          employeeCode: values.employeeCode,
          name: values.name,
          department: values.department,
          jobTitle: values.jobTitle,
          managerCode: values.managerCode || null,
          accessProfile: values.accessProfile || 'SELF_ONLY',
        }),
      });
      if (!r.ok) { errEl.textContent = r.error || 'Failed'; return false; }
      await refreshOrg();
      return true;
    },
  });
}

async function setEmployeeStatus(code, status) {
  const r = await apiJson(RAG_BACKEND + '/api/admin/employees/' + encodeURIComponent(code), {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
  if (!r.ok) {
    alert('Failed to ' + status + ' ' + code + ': ' + (r.error || 'error'));
    return;
  }
  await refreshOrg();
}

async function refreshOrg() {
  await Promise.all([loadEmployees(), loadRelationships(), loadPolicyVersion()]);
  renderOrg();
}

// ── Section 2: Employee Data Sources ──────────────────────────────────────────
function renderSources() {
  const wrap = el('srcTableWrap');
  if (!wrap) return;
  if (!state.sourceLinks.length) {
    wrap.innerHTML = '<div class="state-box">No data source links yet. Use “+ Link Source”.</div>';
    return;
  }
  const empName = (code) => {
    const c = String(code || '').trim().toUpperCase();
    const e = state.employees.find((x) => String(x.employeeCode || '').trim().toUpperCase() === c);
    return e ? (e.name + ' (' + c + ')') : c;
  };
  let rows = state.sourceLinks.map((l) => {
    const enabled = l.enabled !== false;
    const syncStatus = l.syncStatus || l.sync_state || '—';
    const lastSync = l.lastSyncedAt || l.lastSync || l.last_synced_at || null;
    const fileName = l.fileName || l.file_name || l.sourceId || '—';
    return '<tr>' +
      '<td>' + escapeHtml(empName(l.employeeCode)) + '</td>' +
      '<td>' + escapeHtml(fileName) + '</td>' +
      '<td><code>' + escapeHtml(l.sourceId) + '</code></td>' +
      '<td>' + escapeHtml(l.provider || 'onedrive') + '</td>' +
      '<td>' + escapeHtml(syncStatus) + '</td>' +
      '<td>' + fmtTime(lastSync) + '</td>' +
      '<td>' + (enabled
        ? '<span class="badge active">enabled</span>'
        : '<span class="badge deactivated">disabled</span>') + '</td>' +
      '<td>' + (l.shared ? '<span class="badge profile">shared</span>' : '<span class="badge neutral">exclusive</span>') + '</td>' +
      '<td style="white-space:nowrap">' +
      '<button class="btn btn-ghost" data-action="src-toggle" data-id="' + escapeHtml(l.linkId) + '" type="button">' + (enabled ? 'Disable' : 'Enable') + '</button> ' +
      '<button class="btn btn-danger" data-action="src-delete" data-id="' + escapeHtml(l.linkId) + '" type="button">Delete</button>' +
      '</td></tr>';
  }).join('');
  wrap.innerHTML =
    '<table class="data-table"><thead><tr>' +
    '<th>Employee</th><th>File name</th><th>Source ID</th><th>Provider</th>' +
    '<th>Sync status</th><th>Last sync</th><th>Enabled</th><th>Ownership</th><th>Actions</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

async function linkSource() {
  openModal({
    title: 'Link data source',
    submitLabel: 'Link source',
    body:
      '<label class="field"><span>Employee</span><select name="employeeCode">' + employeeOptions('', { includeEmpty: false }) + '</select></label>' +
      '<label class="field"><span>Source ID (file ID / drive ID)</span><input name="sourceId" placeholder="e.g. 01ABCDEF…" /></label>' +
      '<label class="field"><span>File name</span><input name="fileName" placeholder="EMP001.xlsx" /></label>' +
      '<label class="field"><span>Provider</span><select name="provider"><option value="onedrive">OneDrive</option><option value="excel">Excel upload</option></select></label>' +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="shared" value="true" style="width:auto" /><span>Shared source (allow multiple owners)</span></label>' +
      '<div class="section-hint" style="margin:0">Linking a source already owned by another employee is rejected (409) unless shared.</div>',
    onSubmit: async (values, errEl) => {
      if (!values.employeeCode || !values.sourceId) { errEl.textContent = 'Employee and source ID are required'; return false; }
      const r = await apiJson(RAG_BACKEND + '/api/admin/source-links', {
        method: 'POST',
        body: JSON.stringify({
          employeeCode: values.employeeCode,
          sourceId: values.sourceId,
          fileName: values.fileName,
          provider: values.provider || 'onedrive',
          shared: values.shared === 'true',
        }),
      });
      if (!r.ok) { errEl.textContent = r.error || 'Failed'; return false; }
      await refreshSources();
      return true;
    },
  });
}

async function toggleSource(linkId) {
  const link = state.sourceLinks.find((l) => l.linkId === linkId);
  if (!link) return;
  const r = await apiJson(RAG_BACKEND + '/api/admin/source-links/' + encodeURIComponent(linkId), {
    method: 'PUT',
    body: JSON.stringify({ enabled: link.enabled === false }),
  });
  if (!r.ok) { alert('Failed: ' + (r.error || 'error')); return; }
  await refreshSources();
}

async function deleteSource(linkId) {
  if (!confirm('Delete this source link?')) return;
  const r = await apiJson(RAG_BACKEND + '/api/admin/source-links/' + encodeURIComponent(linkId), {
    method: 'DELETE',
  });
  if (!r.ok) { alert('Failed: ' + (r.error || 'error')); return; }
  await refreshSources();
}

async function reindex() {
  if (!confirm('Re-index is a protected, admin-only operation. It rebuilds the search index and vectors. Continue?')) return;
  const btn = el('srcReindexBtn');
  if (btn) btn.disabled = true;
  const r = await apiJson(RAG_BACKEND + '/api/admin/reindex', { method: 'POST', body: JSON.stringify({}) });
  if (btn) btn.disabled = false;
  if (!r.ok) {
    alert('Re-index failed: ' + (r.error || 'error'));
    return;
  }
  alert('Re-index complete.');
  await refreshSources();
}

async function refreshSources() {
  await Promise.all([loadSourceLinks(), loadEmployees(), loadPolicyVersion()]);
  renderSources();
}

// ── Section 3: Permission Matrix ─────────────────────────────────────────────
const RESOURCE_TYPES = ['source', 'sheet', 'field', 'record'];
const EFFECTS = ['allow', 'deny', 'redact'];

// Mirror of policyEngine.evaluatePolicies (deny-over-allow, deny-by-default).
// Used only as a display aid in the matrix; Preview As User uses the real engine.
function evaluatePoliciesClient(subject, resource, policies) {
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const matches = policies.filter((p) => {
    if (p.subjectType === 'employee') {
      if (p.subjectId !== subject.employeeCode) return false;
    } else if (p.subjectId != null) {
      if (p.subjectId !== subject.profileCode) return false;
    }
    const target = norm(p.resourceName);
    if (!target) return false;
    const sheet = norm(resource.sheet);
    const field = norm(resource.field);
    const source = norm(resource.source);
    const rt = p.resourceType;
    if (rt === 'sheet') return sheet === target || sheet.includes(target);
    if (rt === 'source') return source === target || source.includes(target);
    if (rt === 'field') {
      if (sheet && field && sheet + '.' + field === target) return true;
      if (field && (field === target || field.includes(target) || target.includes(field))) return true;
      if (sheet && target && sheet.includes(target)) return true;
      return false;
    }
    return false;
  });
  if (!matches.length) return { effect: 'deny', matches: [] };
  const denies = matches.filter((p) => p.effect === 'deny');
  if (denies.length) {
    const top = denies.slice().sort((a, b) => b.priority - a.priority)[0];
    return { effect: 'deny', matches, topId: top.policyId };
  }
  const top = matches.slice().sort((a, b) => b.priority - a.priority)[0];
  return { effect: top.effect, matches, topId: top.policyId };
}

function subjectLabel(p) {
  if (p.subjectType === 'employee') return 'employee:' + (p.subjectId || '?');
  if (p.subjectId == null) return 'all profiles';
  return 'profile:' + p.subjectId;
}

function effectBadge(effect) {
  return '<span class="badge ' + effect + '">' + effect + '</span>';
}

function renderMatrix() {
  const toolbar = el('matrixToolbar');
  const body = el('matrixBody');
  if (!toolbar || !body) return;

  toolbar.innerHTML =
    '<label class="field"><span>Subject type</span><select id="mxSubjectType">' +
    '<option value="profile">Access profile</option><option value="employee">Employee</option></select></label>' +
    '<label class="field"><span>Subject</span><select id="mxSubject"></select></label>' +
    '<label class="field"><span>Resource type</span><select id="mxResourceType">' +
    RESOURCE_TYPES.map((t) => '<option value="' + t + '">' + t + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Resource name</span><input id="mxResourceName" placeholder="e.g. compensation" /></label>' +
    '<button class="btn btn-primary" id="mxCheckBtn" type="button">Check effective</button>';

  const subjTypeSel = el('mxSubjectType');
  const subjSel = el('mxSubject');
  const updateSubjects = () => {
    if (subjTypeSel.value === 'profile') {
      subjSel.innerHTML = state.profiles.map((p) =>
        '<option value="' + escapeHtml(p.profileCode) + '">' + escapeHtml(p.profileCode) + ' — ' + escapeHtml(p.label || '') + '</option>').join('');
    } else {
      subjSel.innerHTML = state.employees.map((e) =>
        '<option value="' + escapeHtml(e.employeeCode) + '">' + escapeHtml(e.employeeCode) + ' — ' + escapeHtml(e.name || '') + '</option>').join('');
    }
  };
  subjTypeSel.addEventListener('change', updateSubjects);
  updateSubjects();

  el('mxCheckBtn').addEventListener('click', () => {
    renderEffective(subjTypeSel.value, subjSel.value, el('mxResourceType').value, el('mxResourceName').value.trim());
  });

  body.innerHTML =
    '<div id="mxEffective" class="preview-summary">Select a subject and resource, then “Check effective”.</div>' +
    '<div id="mxPolicies"></div>';
  renderPoliciesTable();
}

function renderEffective(subjectType, subjectId, resourceType, resourceName) {
  const panel = el('mxEffective');
  if (!panel) return;
  if (!resourceName) { panel.textContent = 'Enter a resource name to check effective permission.'; return; }
  const subject = subjectType === 'employee'
    ? { employeeCode: subjectId, profileCode: null }
    : { profileCode: subjectId, employeeCode: null };
  const resource = { resourceType, source: resourceName, sheet: resourceName, field: resourceName };
  const result = evaluatePoliciesClient(subject, resource, state.policies);

  const effectsSeen = new Set(result.matches.map((m) => m.effect));
  const conflict = effectsSeen.size > 1;

  let html = '<div><strong>Effective:</strong> ' + effectBadge(result.effect) +
    ' &nbsp;<span class="conflict-flag">' + (conflict ? '⚠ conflict — multiple effects match' : '') + '</span></div>';
  html += '<div style="margin-top:6px;font-size:12px;color:var(--muted)">Matched policies (' + result.matches.length + '):</div>';
  if (!result.matches.length) {
    html += '<div style="font-size:12px;color:var(--muted)">None — deny-by-default.</div>';
  } else {
    html += result.matches.map((m) =>
      '<div style="font-size:12px;margin-top:2px">' +
      (m.policyId === result.topId ? '▸ ' : '· ') +
      '<span class="badge neutral">' + escapeHtml(m.resourceType) + '</span> ' +
      escapeHtml(subjectLabel(m)) + ' → ' + escapeHtml(m.resourceName) + ' ' +
      effectBadge(m.effect) + ' (priority ' + m.priority + ')' +
      (m.subjectId == null ? ' <span class="badge profile">inherited</span>' : ' <span class="badge neutral">override</span>') +
      '</div>').join('');
  }
  panel.innerHTML = html;
}

function renderPoliciesTable() {
  const wrap = el('mxPolicies');
  if (!wrap) return;
  if (!state.policies.length) {
    wrap.innerHTML = '<div class="state-box">No policies defined.</div>';
    return;
  }
  const rows = state.policies.map((p) => {
    const effectBtns = EFFECTS.map((e) =>
      '<button class="effect-btn' + (p.effect === e ? ' is-' + e : '') + '" data-action="pol-effect" data-id="' + escapeHtml(p.policyId) + '" data-effect="' + e + '" type="button">' + e + '</button>').join('');
    return '<div class="matrix-row">' +
      '<div class="matrix-subject">' + escapeHtml(subjectLabel(p)) + '</div>' +
      '<div class="matrix-resource"><span class="badge neutral">' + escapeHtml(p.resourceType) + '</span> ' + escapeHtml(p.resourceName) + '</div>' +
      '<div class="matrix-effect">' + effectBtns + '</div>' +
      '<div style="color:var(--muted);font-size:12px">prio ' + p.priority + '</div>' +
      '<button class="btn btn-danger" data-action="pol-delete" data-id="' + escapeHtml(p.policyId) + '" type="button">Delete</button>' +
      '</div>';
  }).join('');
  wrap.innerHTML = rows;
}

async function addPolicy() {
  openModal({
    title: 'Add permission policy',
    submitLabel: 'Add policy',
    body:
      '<label class="field"><span>Subject type</span><select name="subjectType"><option value="profile">Access profile</option><option value="employee">Employee</option></select></label>' +
      '<label class="field"><span>Subject ID</span><input name="subjectId" placeholder="e.g. TEAM_MANAGER (blank = all profiles)" /></label>' +
      '<label class="field"><span>Resource type</span><select name="resourceType">' + RESOURCE_TYPES.map((t) => '<option value="' + t + '">' + t + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Resource name</span><input name="resourceName" placeholder="e.g. compensation / Employee_Profile.mainWeakness" /></label>' +
      '<label class="field"><span>Effect</span><select name="effect">' + EFFECTS.map((e) => '<option value="' + e + '">' + e + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Priority (number)</span><input name="priority" type="number" value="50" /></label>' +
      '<label class="field"><span>Note</span><input name="note" /></label>',
    onSubmit: async (values, errEl) => {
      if (!values.resourceName) { errEl.textContent = 'Resource name is required'; return false; }
      const r = await apiJson(RAG_BACKEND + '/api/admin/policies', {
        method: 'POST',
        body: JSON.stringify({
          subjectType: values.subjectType,
          subjectId: values.subjectId || null,
          resourceType: values.resourceType,
          resourceName: values.resourceName,
          effect: values.effect,
          priority: Number(values.priority) || 0,
          note: values.note,
        }),
      });
      if (!r.ok) { errEl.textContent = r.error || 'Failed'; return false; }
      await refreshMatrix();
      return true;
    },
  });
}

async function setPolicyEffect(policyId, effect) {
  const r = await apiJson(RAG_BACKEND + '/api/admin/policies/' + encodeURIComponent(policyId), {
    method: 'PUT',
    body: JSON.stringify({ effect }),
  });
  if (!r.ok) { alert('Failed: ' + (r.error || 'error')); return; }
  await refreshMatrix();
}

async function deletePolicy(policyId) {
  if (!confirm('Delete this policy?')) return;
  const r = await apiJson(RAG_BACKEND + '/api/admin/policies/' + encodeURIComponent(policyId), { method: 'DELETE' });
  if (!r.ok) { alert('Failed: ' + (r.error || 'error')); return; }
  await refreshMatrix();
}

async function refreshMatrix() {
  await Promise.all([loadPolicies(), loadProfiles(), loadEmployees(), loadPolicyVersion()]);
  renderMatrix();
}

// ── Section 4: Preview As User ────────────────────────────────────────────────
function renderPreview() {
  const toolbar = el('previewToolbar');
  const body = el('previewBody');
  if (!toolbar || !body) return;

  toolbar.innerHTML =
    '<label class="field"><span>Viewer (employee)</span><select id="pvViewer">' +
    employeeOptions('', { includeEmpty: false }) + '</select></label>' +
    '<label class="field"><span>Profile override (optional)</span><select id="pvProfile">' +
    '<option value="">— use employee’s assigned profile —</option>' +
    state.profiles.map((p) => '<option value="' + escapeHtml(p.profileCode) + '">' + escapeHtml(p.profileCode) + ' — ' + escapeHtml(p.label || '') + '</option>').join('') +
    '</select></label>' +
    '<button class="btn btn-primary" id="pvRunBtn" type="button">Preview</button>';

  el('pvRunBtn').addEventListener('click', () => {
    runPreview(el('pvViewer').value, el('pvProfile').value);
  });

  body.innerHTML = '<div class="state-box">Select a viewer and click “Preview”. This calls the backend policy engine (same engine as real requests).</div>';
}

async function runPreview(viewerCode, profileCode) {
  const body = el('previewBody');
  if (!body) return;
  body.innerHTML = '<div class="state-box"><span class="spinner"></span><br/>Evaluating policy…</div>';
  const r = await apiJson(RAG_BACKEND + '/api/admin/preview', {
    method: 'POST',
    body: JSON.stringify({ viewerCode, profileCode: profileCode || null }),
  });
  if (!r.ok) {
    body.innerHTML = '<div class="state-box error">Preview failed: ' + escapeHtml(r.error || ('HTTP ' + r.status)) +
      '<br/><span style="font-size:12px">(The /api/admin/preview endpoint is provided by backend-security.)</span></div>';
    return;
  }
  const data = r.data || {};
  const viewer = data.viewer || {};
  const records = data.records || [];

  let html = '<div class="preview-summary">' +
    '<strong>Viewer:</strong> ' + escapeHtml(viewer.employeeCode || viewerCode) +
    ' · profile <span class="badge profile">' + escapeHtml(viewer.profileCode || profileCode || '—') + '</span>' +
    ' · scope <span class="badge neutral">' + escapeHtml(viewer.scope || data.scope || '—') + '</span>' +
    ' · records ' + records.length +
    '</div>';

  if (!records.length) {
    html += '<div class="state-box">No records returned for this viewer.</div>';
  } else {
    for (const rec of records) {
      const status = String(rec.status || rec.effect || 'visible').toLowerCase();
      const cls = status === 'redacted' ? 'redacted' : (status === 'blocked' || status === 'deny' ? 'blocked' : 'visible');
      const label = status === 'redacted' ? 'REDACTED' : (status === 'blocked' || status === 'deny' ? 'BLOCKED' : 'VISIBLE');
      html += '<div class="preview-record ' + cls + '">' +
        '<div class="rec-head">' +
        '<span class="badge ' + cls + '">' + label + '</span>' +
        '<span style="color:var(--muted)">' + escapeHtml(rec.sheetName || rec.sheet || '') + ' · ' + escapeHtml(rec.fieldName || rec.field || '') + '</span>' +
        '<span style="color:var(--muted)">' + escapeHtml(rec.source || rec.fileName || '') + '</span>' +
        '</div>' +
        '<div class="rec-content">' + escapeHtml(rec.content ?? rec.value ?? '') + '</div>' +
        (rec.reason ? '<div style="font-size:11px;color:var(--muted)">reason: ' + escapeHtml(rec.reason) + '</div>' : '') +
        '</div>';
    }
  }
  body.innerHTML = html;
}

// ── Section 5: Audit & Version History ────────────────────────────────────────
function diffSummary(prev, next) {
  if (prev == null && next == null) return '';
  if (prev == null) return '<span class="next">created</span>';
  if (next == null) return '<span class="prev">deleted</span>';
  const keys = new Set([
    ...(typeof prev === 'object' && prev ? Object.keys(prev) : []),
    ...(typeof next === 'object' && next ? Object.keys(next) : []),
  ]);
  const changed = [];
  for (const k of keys) {
    if (JSON.stringify(prev[k]) === JSON.stringify(next[k])) continue;
    changed.push(k);
  }
  if (!changed.length) return '<span class="next">updated (no field diff)</span>';
  return changed.slice(0, 6).map((k) =>
    '<span class="prev"><code>' + escapeHtml(k) + '=' + escapeHtml(JSON.stringify(prev[k])) + '</code></span> → ' +
    '<span class="next"><code>' + escapeHtml(JSON.stringify(next[k])) + '</code></span>'
  ).join(' · ') + (changed.length > 6 ? ' …' : '');
}

function renderAudit() {
  const wrap = el('auditTableWrap');
  if (!wrap) return;
  if (!state.audit.length) {
    wrap.innerHTML = '<div class="state-box">No audit events recorded yet.</div>';
    return;
  }
  const rows = state.audit.map((e) => {
    const actor = e.actor || {};
    const change = e.change || {};
    return '<tr>' +
      '<td class="audit-diff">' + escapeHtml(actor.username || '—') + '<br/><span style="color:var(--muted)">' + escapeHtml(actor.role || '') + '</span></td>' +
      '<td>' + escapeHtml(change.entity || '') + ' / ' + escapeHtml(change.action || '') + '<br/><span style="color:var(--muted)">' + escapeHtml(change.entityId || '') + '</span></td>' +
      '<td>' + fmtTime(e.at) + '</td>' +
      '<td class="audit-diff">' + diffSummary(e.previous, e.next) + '</td>' +
      '<td style="text-align:center">v' + (e.policyVersion ?? '—') + '</td>' +
      '<td><button class="btn btn-ghost" data-action="rollback" data-entity="' + escapeHtml(change.entity) + '" data-id="' + escapeHtml(change.entityId) + '" type="button">Rollback</button></td>' +
      '</tr>';
  }).join('');
  wrap.innerHTML =
    '<table class="data-table"><thead><tr>' +
    '<th>Who</th><th>What</th><th>When</th><th>Previous → New</th><th>Policy v</th><th>Action</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

async function rollback(entity, entityId) {
  if (!confirm('Roll back ' + entity + ' ' + entityId + ' to its previous version?')) return;
  const r = await apiJson(RAG_BACKEND + '/api/admin/rollback', {
    method: 'POST',
    body: JSON.stringify({ entity, entityId }),
  });
  if (!r.ok) { alert('Rollback failed: ' + (r.error || 'error')); return; }
  await refreshAll();
}

async function refreshAll() {
  await loadAll();
  const active = document.querySelector('.admin-section.is-active');
  if (active) switchSection(active.dataset.sectionPanel);
}

// ── Event wiring ──────────────────────────────────────────────────────────────
function toggleOrgNode(code) {
  const node = document.querySelector('.org-node[data-node="' + CSS.escape(code) + '"]');
  if (!node) return;
  const btn = node.querySelector('.org-toggle');
  const children = node.querySelector('.org-children');
  if (!children) return;
  const collapsed = children.classList.toggle('is-collapsed');
  if (btn) btn.textContent = collapsed ? '▸' : '▾';
  if (collapsed) orgCollapsed.add(code); else orgCollapsed.delete(code);
}

function expandAll() {
  orgCollapsed.clear();
  renderOrg();
}
function collapseAll() {
  const snapshot = orgSnapshot;
  if (snapshot) for (const code of snapshot.byCode.keys()) orgCollapsed.add(code);
  renderOrg();
}

function handleAction(target) {
  const action = target.dataset.action;
  const code = target.dataset.code;
  const id = target.dataset.id;
  const effect = target.dataset.effect;
  const entity = target.dataset.entity;

  switch (action) {
    case 'toggle': toggleOrgNode(code); break;
    case 'change-manager': changeManager(code); break;
    case 'move-dept': moveDept(code); break;
    case 'deactivate': setEmployeeStatus(code, 'deactivated'); break;
    case 'activate': setEmployeeStatus(code, 'active'); break;
    case 'src-toggle': toggleSource(id); break;
    case 'src-delete': deleteSource(id); break;
    case 'pol-effect': setPolicyEffect(id, effect); break;
    case 'pol-delete': deletePolicy(id); break;
    case 'rollback': rollback(entity, id); break;
    default: break;
  }
}

function wireEvents() {
  // Nav
  document.querySelectorAll('.admin-nav-item').forEach((b) => {
    b.addEventListener('click', () => switchSection(b.dataset.section));
  });

  // Delegated action handling (org tree, tables, matrix, audit).
  document.body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (t) handleAction(t);
  });

  // Org section buttons
  el('orgAddBtn').addEventListener('click', addEmployee);
  el('orgExpandAllBtn').addEventListener('click', expandAll);
  el('orgCollapseAllBtn').addEventListener('click', collapseAll);

  // Sources section buttons
  el('srcAddBtn').addEventListener('click', linkSource);
  el('srcReindexBtn').addEventListener('click', reindex);

  // Matrix section button
  el('polAddBtn').addEventListener('click', addPolicy);

  // Audit entity filter
  el('auditEntityFilter').addEventListener('change', async (e) => {
    await loadAudit(e.target.value || null);
    renderAudit();
  });

  // Topbar
  el('refreshAllBtn').addEventListener('click', refreshAll);
  el('adminLogoutBtn').addEventListener('click', doLogout);

  // Login form
  el('adminLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin(el('adminLoginUsername').value, el('adminLoginPassword').value);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
wireEvents();
boot();
