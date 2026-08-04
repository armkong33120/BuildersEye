import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createIcons, icons } from 'lucide';
import graph from './data/identity-graph.json';

const canvas = document.querySelector('#scene');
const labelRoot = document.querySelector('#labels');
const personSelect = document.querySelector('#personSelect');
const departmentSelect = document.querySelector('#departmentSelect');
const lineModeSelect = document.querySelector('#lineModeSelect');
const levelLabelToggles = document.querySelector('#levelLabelToggles');
const metricStrip = document.querySelector('#metricStrip');
const departmentLegend = document.querySelector('#departmentLegend');
const detailPanel = document.querySelector('#detailPanel');
const toggleLabelsButton = document.querySelector('#toggleLabels');
const app = document.querySelector('#app');
const topbar = document.querySelector('#topbar');
const toggleTopbarButton = document.querySelector('#toggleTopbar');
const togglePanelButton = document.querySelector('#togglePanel');
const sidePanel = document.querySelector('#sidePanel');
const ragChat = document.querySelector('#ragChat');
const toggleChatButton = document.querySelector('#toggleChat');
const chatMessages = document.querySelector('#chatMessages');
const chatForm = document.querySelector('#chatForm');
const chatInput = document.querySelector('#chatInput');
const sendChatButton = document.querySelector('#sendChat');
const focusCeoButton = document.querySelector('#focusCeo');
const resetCameraButton = document.querySelector('#resetCamera');

const PERSON_RADIUS = 0.18;
const LAYER_COUNT = 4;
const BALL_RADIUS = 10.0;
const LAYER_STEP = BALL_RADIUS / LAYER_COUNT;
const DEPTH_RADII = Array.from({ length: LAYER_COUNT + 1 }, (_, depth) => Number((depth * LAYER_STEP).toFixed(2)));
const CEO_ZONE = 1.4; // Minimum distance from CEO to C-Level nodes
const SCAN_DURATION_MS = 3600;
const DEPARTMENT_SCAN_HOLD_MS = 5200;
const AUTO_ROTATE_RESUME_MS = 5200;
const SCAN_COLOR = '#7cf7ff';
const PATH_COLOR = '#ffd166';

const state = {
  selectedPk: graph.ceoPk,
  department: 'ALL',
  lineMode: 'all',
  labelMode: 'key',
  visibleLabelDepths: new Set([1, 2, 3, 4]),
  scan: null,
  autoRotateTimer: null,
};

const employeesByPk = new Map(graph.identities.map((identity) => [identity.pk, identity]));
const departmentsByName = new Map(graph.departments.map((department) => [department.name, department]));
const positionSlotsByPk = new Map();
const graphNeighborsByPk = new Map();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#030507');
scene.fog = new THREE.Fog('#030507', 18, 44);
const scanGroup = new THREE.Group();
scanGroup.userData = { type: 'scan-effects' };
scene.add(scanGroup);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(14, 10, 17);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const labelRenderer = new CSS2DRenderer({ element: labelRoot });
labelRenderer.setSize(window.innerWidth, window.innerHeight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.34;
controls.minDistance = 6;
controls.maxDistance = 40;
controls.target.set(0, 0, 0);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const selectable = [];
const nodeObjects = new Map();
const lineObjects = [];
const flowDotObjects = [];

setupIcons();
buildIndexes();
buildUi();
buildScene();
selectPerson(graph.ceoPk, false);
animate();

  var resetButton = document.querySelector('#resetChat');
  if (resetButton) {
    resetButton.addEventListener('click', function() {
      newConversation();
    });
  }

  // Load conversation list on startup
  refreshConvoList();

function setupIcons() {
  focusCeoButton.innerHTML = '<i data-lucide="scan-face"></i>';
  resetCameraButton.innerHTML = '<i data-lucide="rotate-ccw"></i>';
  toggleTopbarButton.innerHTML = '<i data-lucide="chevron-up"></i>';
  togglePanelButton.innerHTML = '<i data-lucide="panel-right-close"></i>';
  toggleChatButton.innerHTML = '<i data-lucide="minimize-2"></i>';
  sendChatButton.innerHTML = '<i data-lucide="send-horizontal"></i>';
  var resetBtn = document.querySelector('#resetChat');
  if (resetBtn) resetBtn.innerHTML = '<i data-lucide="refresh-cw"></i>';
  document.querySelectorAll('.collapse-button').forEach((button) => {
    button.innerHTML = '<i data-lucide="chevron-up"></i>';
  });
  createIcons({ icons });
}

function buildIndexes() {
  graph.identities.forEach((identity) => {
    graphNeighborsByPk.set(identity.pk, []);
  });
  graph.reportingLinks.forEach((link) => {
    graphNeighborsByPk.get(link.sourcePk)?.push(link.targetPk);
    graphNeighborsByPk.get(link.targetPk)?.push(link.sourcePk);
  });

  const identitiesByDepth = new Map();
  graph.identities
    .filter((identity) => identity.pk !== graph.ceoPk)
    .forEach((identity) => {
      const depth = visualDepth(identity);
      if (!identitiesByDepth.has(depth)) identitiesByDepth.set(depth, []);
      identitiesByDepth.get(depth).push(identity);
    });

  for (const [depth, identities] of identitiesByDepth.entries()) {
    // Sort by seniority (most senior first) then interleave departments
    const sorted = [...identities].sort((a, b) => seniorityScore(a) - seniorityScore(b));
    const orderedIdentities = interleaveByDepartment(sorted);
    const innerRadius = depth === 1 ? CEO_ZONE : DEPTH_RADII[Math.max(0, depth - 1)];
    const outerRadius = DEPTH_RADII[Math.min(depth, DEPTH_RADII.length - 1)] || BALL_RADIUS;
    // Compute seniority ratios: 0=most senior(inner), 1=most junior(outer)
    const ratios = orderedIdentities.map((id) => {
      const rank = sorted.indexOf(id);
      return sorted.length > 1 ? rank / (sorted.length - 1) : 0.5;
    });
    const slots = layerVolumeSlots(orderedIdentities.length, innerRadius, outerRadius, depth, ratios);
    orderedIdentities.forEach((identity, index) => {
      positionSlotsByPk.set(identity.pk, slots[index]);
    });
  }
}

function buildUi() {
  metricStrip.innerHTML = [
    metricHtml(graph.stats.employeeCount, 'Accounts'),
    metricHtml(graph.stats.reportingLinkCount, 'Reporting lines'),
    metricHtml(graph.stats.oneDriveSiteCount, 'OneDrive sites'),
  ].join('');

  const keyPeople = graph.identities.filter((identity) => identity.directReportCount > 0 || identity.pk === graph.ceoPk);
  const others = graph.identities.filter((identity) => !keyPeople.includes(identity));
  personSelect.innerHTML = [
    '<optgroup label="Managers and key roles">',
    ...keyPeople.map(personOption),
    '</optgroup>',
    '<optgroup label="All identities">',
    ...others.map(personOption),
    '</optgroup>',
  ].join('');
  personSelect.value = String(state.selectedPk);

  departmentSelect.innerHTML = [
    '<option value="ALL">All departments</option>',
    ...graph.departments.map((department) => `<option value="${escapeHtml(department.name)}">${escapeHtml(department.name)}</option>`),
  ].join('');
  departmentSelect.value = state.department;
  lineModeSelect.value = state.lineMode;
  renderLevelLabelToggles();

  departmentLegend.innerHTML = graph.departments
    .map(
      (department) => `<div class="legend-row">
        <span class="legend-dot" style="--dept-color:${department.color}"></span>
        <span>${escapeHtml(shortDept(department.name))}</span>
        <strong>${department.employeeCount}</strong>
      </div>`,
    )
    .join('');

  personSelect.addEventListener('change', () => {
    selectPerson(Number(personSelect.value));
  });
  departmentSelect.addEventListener('change', () => {
    state.department = departmentSelect.value;
    updateVisibility();
  });
  lineModeSelect.addEventListener('change', () => {
    state.lineMode = lineModeSelect.value;
    updateVisibility();
  });
  levelLabelToggles.addEventListener('click', (event) => {
    const button = event.target.closest('.level-toggle');
    if (!button) return;
    const depth = Number(button.dataset.depth);
    if (state.visibleLabelDepths.has(depth)) state.visibleLabelDepths.delete(depth);
    else state.visibleLabelDepths.add(depth);
    updateLevelToggleState();
    updateVisibility();
  });
  toggleLabelsButton.addEventListener('click', () => {
    state.labelMode = state.labelMode === 'key' ? 'all' : 'key';
    toggleLabelsButton.textContent = state.labelMode === 'key' ? 'Key Labels' : 'All Labels';
    updateVisibility();
  });
  toggleTopbarButton.addEventListener('click', toggleTopbar);
  togglePanelButton.addEventListener('click', toggleSidePanel);
  toggleChatButton.addEventListener('click', toggleChat);
  chatForm.addEventListener('submit', handleChatSubmit);
  // Dynamic send button — glows when input has text
  chatInput.addEventListener('input', function() {
    var hasText = chatInput.value.trim().length > 0;
    sendChatButton.classList.toggle('is-ready', hasText);
  });
  document.querySelectorAll('.collapse-button[data-collapse]').forEach((button) => {
    button.addEventListener('click', () => toggleCollapsiblePanel(button));
  });
  focusCeoButton.addEventListener('click', () => selectPerson(graph.ceoPk));
  resetCameraButton.addEventListener('click', () => {
    camera.position.set(14, 10, 17);
    controls.target.set(0, 0, 0);
    controls.autoRotate = true;
    controls.update();
  });
}

function toggleChat() {
  const isNowCollapsed = ragChat.classList.toggle('is-collapsed');
  toggleChatButton.setAttribute('aria-expanded', String(!isNowCollapsed));
  toggleChatButton.setAttribute('title', isNowCollapsed ? 'Expand chat' : 'Collapse chat');
  toggleChatButton.setAttribute('aria-label', isNowCollapsed ? 'Expand chat' : 'Collapse chat');
  toggleChatButton.innerHTML = isNowCollapsed
    ? '<i data-lucide="maximize-2"></i>'
    : '<i data-lucide="minimize-2"></i>';
  createIcons({ icons });
}

function toggleTopbar() {
  const isNowHidden = topbar.classList.toggle('is-hidden');
  app.classList.toggle('is-topbar-hidden', isNowHidden);
  toggleTopbarButton.setAttribute('aria-expanded', String(!isNowHidden));
  toggleTopbarButton.setAttribute('title', isNowHidden ? 'Show top bar' : 'Hide top bar');
  toggleTopbarButton.setAttribute('aria-label', isNowHidden ? 'Show top bar' : 'Hide top bar');
  toggleTopbarButton.innerHTML = isNowHidden ? '<i data-lucide="chevron-down"></i>' : '<i data-lucide="chevron-up"></i>';
  createIcons({ icons });
}

function toggleSidePanel() {
  const isNowHidden = sidePanel.classList.toggle('is-hidden');
  togglePanelButton.setAttribute('aria-expanded', String(!isNowHidden));
  togglePanelButton.setAttribute('title', isNowHidden ? 'Show panels' : 'Hide panels');
  togglePanelButton.setAttribute('aria-label', isNowHidden ? 'Show panels' : 'Hide panels');
  togglePanelButton.innerHTML = isNowHidden
    ? '<i data-lucide="panel-right-open"></i>'
    : '<i data-lucide="panel-right-close"></i>';
  createIcons({ icons });
}

function toggleCollapsiblePanel(button) {
  const panelName = button.dataset.collapse;
  const panel = document.querySelector(`[data-panel="${panelName}"]`);
  if (!panel) return;
  const isCollapsed = panel.classList.toggle('is-collapsed');
  button.setAttribute('aria-expanded', String(!isCollapsed));
  button.setAttribute('aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} ${panelName}`);
  button.innerHTML = isCollapsed ? '<i data-lucide="chevron-down"></i>' : '<i data-lucide="chevron-up"></i>';
  createIcons({ icons });
}

function renderLevelLabelToggles() {
  levelLabelToggles.innerHTML = Array.from({ length: LAYER_COUNT }, (_, index) => {
    const depth = index + 1;
    return `<button class="level-toggle" type="button" data-depth="${depth}" aria-pressed="true">LV${depth}</button>`;
  }).join('');
  updateLevelToggleState();
}

function updateLevelToggleState() {
  levelLabelToggles.querySelectorAll('.level-toggle').forEach((button) => {
    const depth = Number(button.dataset.depth);
    const isOn = state.visibleLabelDepths.has(depth);
    button.classList.toggle('is-off', !isOn);
    button.setAttribute('aria-pressed', String(isOn));
  });
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const prompt = chatInput.value.trim();
  if (!prompt) return;

  appendChatMessage('user', 'You', prompt);
  chatInput.value = '';
  sendChatButton.classList.remove('is-ready');

  // Loading state — 3-dot bounce
  var thinkingEl = document.createElement('article');
  thinkingEl.className = 'chat-message assistant thinking';
  thinkingEl.innerHTML =
    '<div class="thinking-dots">' +
      '<span class="thinking-dot"></span>' +
      '<span class="thinking-dot"></span>' +
      '<span class="thinking-dot"></span>' +
    '</div>' +
    '<div class="typing-status">Searching 150 files…</div>';
  chatMessages.append(thinkingEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Try RAG backend first
  var ragData = await callRagBackend(prompt);
  thinkingEl.remove();

  if (ragData && ragData.answer) {
    var sources = (ragData.sources || []).slice(0, 4).map(function(s) { return s.fileName || s.file + ':' + s.sheetName; });
    var structuredSources = ragData.sources && ragData.sources.length > 0 ? ragData.sources : null;
    appendChatMessage('assistant', 'RAG', ragData.answer, sources, {
      policy: ragData.policy,
      responseTimeMs: ragData.responseTimeMs,
      matchersUsed: ragData.matchersUsed,
      matchedEmployeePks: ragData.matchedEmployeePks,
      structuredSources: structuredSources,
    });
    highlightRagResults(ragData);
    return;
  }

  const department = findDepartmentPrompt(prompt);
  if (department) {
    startDepartmentScan(department);
    return;
  }

  const scanResult = startGraphScan(prompt);
  const selected = employeesByPk.get(state.selectedPk);
  const visibleAccounts = Array.from(nodeObjects.values()).filter((mesh) => mesh.visible).length;
  const visibleLines = lineObjects.filter((line) => line.visible).length;
  const answer = selected
    ? `กำลังสแกนจาก context ${selected.code} ${selected.jobTitle} ไปยัง ${scanResult.relatedCount} node ที่เกี่ยวข้อง และเชื่อม ${scanResult.pathCount} path จาก org graph. มุมมองปัจจุบันมี ${visibleAccounts} accounts และ ${visibleLines} reporting lines ที่ผ่าน filter.`
    : `มุมมองปัจจุบันมี ${visibleAccounts} accounts และ ${visibleLines} reporting lines ที่ผ่าน filter.`;
  window.setTimeout(() => {
    appendChatMessage('assistant', 'RAG', answer, ['identity-graph.json', 'visible graph state']);
  }, 180);
}

function appendChatMessage(role, label, text, sources = [], extras = {}) {
  const message = document.createElement('article');
  message.className = `chat-message ${role}`;
  const time = new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());

  var policyHtml = '';
  if (extras.policy && extras.policy.status) {
    var status = extras.policy.status;
    var badgeText = '● ' + status;
    if (status === 'Redacted' && extras.policy.redactedCount > 0) {
      badgeText = '● Redacted (' + extras.policy.redactedCount + ')';
    }
    var badgeClass = 'allowed';
    if (status === 'Redacted') badgeClass = 'redacted';
    else if (status === 'Blocked') badgeClass = 'blocked';
    policyHtml = '<span class="policy-badge ' + badgeClass + '">' + escapeHtml(badgeText) + '</span>';
  }

  var metaHtml = '';

  // Matched employees list
  var matchedEmpHtml = '';
  if (extras.matchedEmployeePks && extras.matchedEmployeePks.length > 0) {
    var empItems = extras.matchedEmployeePks.map(function(pk) {
      var emp = employeesByPk.get(pk);
      if (!emp) return '';
      var shortName = shortPersonName(emp.name);
      return '<div class="matched-emp-item" data-pk="' + pk + '" title="Click to focus on graph">' +
        '<span class="emp-dot" style="background:' + (departmentsByName.get(emp.department)?.color || '#888') + '"></span>' +
        '<span class="emp-code">' + escapeHtml(emp.code) + '</span>' +
        escapeHtml(shortName) +
        ' <span class="emp-dept">· ' + escapeHtml(emp.department) + '</span></div>';
    }).join('');
    matchedEmpHtml = '<div class="matched-employees">' +
      '<button class="matched-employees-toggle" type="button">👥 ' + extras.matchedEmployeePks.length + ' คนที่เกี่ยวข้อง — คลิกดูบนกราฟ</button>' +
      '<div class="matched-employees-list">' + empItems + '</div></div>';
  }

  // Source drawer
  var sourceHtml = '';
  if (extras.structuredSources && extras.structuredSources.length > 0) {
    var srcItems = extras.structuredSources.map(function(s) {
      var fname = s.fileName || s.file || '';
      var url = 'https://github.com/armkong33120/BuildersEye/blob/main/src/data/hr_onedrive_demo/' + fname;
      return '<div class="source-drawer-item">' +
        '<a href="' + url + '" target="_blank" class="excel-link">' + escapeHtml(fname) + '</a>' +
        ' <span class="src-sheet">→ ' + escapeHtml(s.sheetName || '') + '</span>' +
        (s.rowNumber ? ' (row ' + s.rowNumber + ')' : '') + '</div>';
    }).join('');
    sourceHtml = '<div class="source-drawer">' +
      '<button class="source-drawer-toggle" type="button">📎 ' + extras.structuredSources.length + ' sources</button>' +
      '<div class="source-drawer-list">' + srcItems + '</div></div>';
  } else if (sources.length) {
    // Fallback: plain source-row
    sourceHtml = '<div class="source-row">' + sources.map(function(source) {
      return '<span>' + escapeHtml(source) + '</span>';
    }).join('') + '</div>';
  }

  message.innerHTML =
    '<div class="message-identity">' +
      '<div class="message-avatar">' + (role === 'user' ? 'YOU' : 'BE') + '</div>' +
      '<span class="message-sender">' + escapeHtml(label) + '</span>' +
    '</div>' +
    '<p>' + escapeHtml(text) + '</p>' + metaHtml + sourceHtml + matchedEmpHtml +
    '<div class="message-footer">' +
      '<span class="message-time">' + escapeHtml(time) + '</span>' +
      (extras.responseTimeMs !== undefined ? '<span class="response-time">⚡ ' + extras.responseTimeMs + 'ms</span>' : '') +
      policyHtml +
    '</div>';

  // Attach event listeners after DOM insertion
  chatMessages.append(message);

  // Toggle: matched employees list
  var empToggle = message.querySelector('.matched-employees-toggle');
  if (empToggle) {
    empToggle.addEventListener('click', function() {
      var list = message.querySelector('.matched-employees-list');
      if (list) list.classList.toggle('is-open');
    });
  }

  // Toggle: source drawer
  var srcToggle = message.querySelector('.source-drawer-toggle');
  if (srcToggle) {
    srcToggle.addEventListener('click', function() {
      var list = message.querySelector('.source-drawer-list');
      if (list) list.classList.toggle('is-open');
    });
  }

  // Click: matched employee item → focus in 3D graph
  message.addEventListener('click', function(e) {
    var item = e.target.closest('.matched-emp-item');
    if (!item) return;
    var pk = parseInt(item.dataset.pk);
    if (pk && !isNaN(pk)) selectPerson(pk);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function findDepartmentPrompt(prompt) {
  const query = normalizeSearchText(prompt);
  return graph.departments.find((department) => {
    const name = normalizeSearchText(department.name);
    const shortName = normalizeSearchText(shortDept(department.name));
    const aliases = departmentAliases(department.name).map(normalizeSearchText);
    return query === name || query === shortName || aliases.includes(query);
  });
}

function departmentAliases(name) {
  const aliases = {
    'Customer Service & Warranty': ['customer service', 'warranty', 'cs'],
    'Design & Architecture': ['design', 'architecture'],
    'Engineering & Construction': ['engineering', 'construction'],
    Executive: ['exec', 'management'],
    'Finance & Accounting': ['finance', 'accounting'],
    'HR & Admin': ['hr', 'admin'],
    IT: ['information technology'],
    Legal: ['law'],
    Marketing: ['market'],
    'Office Support': ['office'],
    'Procurement & Warehouse': ['procurement', 'warehouse'],
    Sales: ['sale'],
  };
  return aliases[name] || [];
}

function startDepartmentScan(department) {
  clearScanEffects();
  pauseAutoRotate(DEPARTMENT_SCAN_HOLD_MS + 900);
  const departmentPks = graph.identities.filter((identity) => identity.department === department.name).map((identity) => identity.pk);
  const nodePks = new Set(departmentPks);
  const edgeKeys = new Set();

  lineObjects.forEach((line) => {
    if (nodePks.has(line.userData.sourcePk) && nodePks.has(line.userData.targetPk)) {
      edgeKeys.add(edgeKey(line.userData.sourcePk, line.userData.targetPk));
    }
  });

  createGlobalBallFlash(department.color || SCAN_COLOR);
  createScanNodeHalos(nodePks, department.color || SCAN_COLOR);
  createScanPathLines(edgeKeys, department.color || PATH_COLOR);
  applyDepartmentFocus(department.name, nodePks, edgeKeys);
  state.scan = {
    startedAt: performance.now(),
    duration: DEPARTMENT_SCAN_HOLD_MS,
    sourcePk: graph.ceoPk,
    nodePks,
    edgeKeys,
    mode: 'department',
  };
}

function pauseAutoRotate(duration = AUTO_ROTATE_RESUME_MS) {
  controls.autoRotate = false;
  if (state.autoRotateTimer) window.clearTimeout(state.autoRotateTimer);
  state.autoRotateTimer = window.setTimeout(() => {
    resumeAutoRotate();
  }, duration);
}

function resumeAutoRotate() {
  if (state.autoRotateTimer) {
    window.clearTimeout(state.autoRotateTimer);
    state.autoRotateTimer = null;
  }
  controls.autoRotate = true;
}


// RAG backend integration
const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
// Backend URL priority: ?backend= query param > VITE_RAG_BACKEND env > localhost default
const RAG_BACKEND = (urlParams && urlParams.get('backend'))
  || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_RAG_BACKEND)
  || 'http://localhost:5199';
var currentConversationId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);

// --- Conversation History ---
async function loadConversations() {
  try {
    var res = await fetch(RAG_BACKEND + '/api/conversations', {
      headers: authHeaders(),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) { return []; }
}

async function loadConversationMessages(convoId) {
  try {
    var res = await fetch(RAG_BACKEND + '/api/conversations/' + convoId, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function deleteConversationRemote(convoId) {
  try {
    await fetch(RAG_BACKEND + '/api/conversations/' + convoId, {
      method: 'DELETE',
      headers: authHeaders(),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) { /* ignore */ }
}

function authHeaders() {
  var key = typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_API_KEY;
  if (!key) key = window.localStorage?.getItem('builderseye_app_key') || '';
  return key ? { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function renderConversationList(conversations) {
  var existing = document.querySelector('#convoList');
  if (existing) existing.remove();

  if (!conversations || conversations.length === 0) return;

  var list = document.createElement('div');
  list.id = 'convoList';
  list.className = 'convo-list';

  conversations.forEach(function(c) {
    var item = document.createElement('div');
    item.className = 'convo-item' + (c.id === currentConversationId ? ' is-active' : '');
    item.innerHTML =
      '<span class="convo-title">' + escapeHtml(c.title || 'New Chat') + '</span>' +
      '<span class="convo-meta">' + (c.messageCount || 0) + ' msgs</span>' +
      '<button class="convo-delete" data-id="' + c.id + '" title="Delete">×</button>';
    item.addEventListener('click', function(e) {
      if (e.target.classList.contains('convo-delete')) {
        e.stopPropagation();
        deleteConversationRemote(c.id);
        if (c.id === currentConversationId) newConversation();
        setTimeout(refreshConvoList, 300);
        return;
      }
      switchConversation(c.id);
    });
    list.appendChild(item);
  });

  // Insert after chat body
  var body = document.querySelector('#chatMessages');
  if (body) body.parentNode.insertBefore(list, body.nextSibling);
}

async function refreshConvoList() {
  var convos = await loadConversations();
  renderConversationList(convos);
}

async function switchConversation(convoId) {
  currentConversationId = convoId;
  chatMessages.innerHTML = '';
  var data = await loadConversationMessages(convoId);
  if (data && data.messages) {
    data.messages.forEach(function(m) {
      appendChatMessage(m.role, m.role === 'user' ? 'You' : 'RAG', m.text);
    });
  }
  refreshConvoList();
}

function newConversation() {
  currentConversationId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  chatMessages.innerHTML = '';
  refreshConvoList();
}

async function callRagBackend(query) {
  try {
    const res = await fetch(RAG_BACKEND + '/api/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query: query, conversationId: currentConversationId }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

function highlightRagResults(data) {
  clearScanEffects();
  var nodePks = new Set(data.scan?.employeePks || data.matchedEmployeePks || []);
  var edgeKeys = new Set();
  lineObjects.forEach(function(line) {
    if (nodePks.has(line.userData.sourcePk) && nodePks.has(line.userData.targetPk)) {
      edgeKeys.add(edgeKey(line.userData.sourcePk, line.userData.targetPk));
    }
  });
  if (nodePks.size > 0) {
    // Stronger halo + glow material for matched nodes
    createScanNodeHalos(nodePks, '#63d8ff');
    // Add emissive glow directly to matched node meshes
    nodePks.forEach(function(pk) {
      var mesh = nodeObjects.get(pk);
      if (mesh && mesh.material) {
        // Store original for restore
        if (!mesh.userData._origEmissive) {
          mesh.userData._origEmissive = mesh.material.emissive.getHex();
          mesh.userData._origEmissiveIntensity = mesh.material.emissiveIntensity;
        }
        mesh.material.emissive.set('#ffffff');
        mesh.material.emissiveIntensity = 1.2;
      }
    });
    if (edgeKeys.size > 0) createScanPathLines(edgeKeys, '#ffd166');
    // Longer hold (12s) + resume auto-rotate after
    pauseAutoRotate(12000);
    // Auto-focus camera on first matched node
    var firstPk = Array.from(nodePks)[0];
    var firstMesh = nodeObjects.get(firstPk);
    if (firstMesh) {
      controls.target.copy(firstMesh.position.clone().multiplyScalar(0.2));
      controls.update();
    }
  }
  state.scan = {
    startedAt: performance.now(), duration: 12000,
    sourcePk: graph.ceoPk, nodePks: nodePks, edgeKeys: edgeKeys, mode: 'rag-search',
  };
}

function applyDepartmentFocus(departmentName, nodePks, edgeKeys) {
  nodeObjects.forEach((mesh, pk) => {
    const isMatch = nodePks.has(pk);
    mesh.visible = true;
    mesh.material.opacity = isMatch ? 1 : 0.12;
    mesh.scale.setScalar(isMatch ? 1.55 : 0.72);
    if (mesh.userData.label) {
      mesh.userData.label.visible = isMatch && shouldShowLabel(mesh.userData.identity, true);
    }
  });

  lineObjects.forEach((line) => {
    const isMatch = edgeKeys.has(edgeKey(line.userData.sourcePk, line.userData.targetPk));
    line.visible = isMatch;
    line.material.opacity = isMatch ? 0.74 : 0.04;
  });

  flowDotObjects.forEach((dot) => {
    dot.visible = edgeKeys.has(edgeKey(dot.userData.line.userData.sourcePk, dot.userData.line.userData.targetPk));
  });

  departmentSelect.value = departmentName;
  state.department = departmentName;
}

function startGraphScan(prompt) {
  clearScanEffects();
  const sourcePk = state.selectedPk || graph.ceoPk;
  const relatedIdentities = findRelatedIdentities(prompt, sourcePk);
  const relatedPks = new Set([sourcePk, ...relatedIdentities.map((identity) => identity.pk)]);
  const pathEdges = new Set();
  const pathPks = new Set([sourcePk]);

  relatedIdentities.forEach((identity) => {
    const path = shortestOrgPath(sourcePk, identity.pk);
    path.forEach((pk) => pathPks.add(pk));
    for (let index = 0; index < path.length - 1; index += 1) {
      pathEdges.add(edgeKey(path[index], path[index + 1]));
    }
  });

  pathPks.forEach((pk) => relatedPks.add(pk));
  createScanWaves(sourcePk);
  createScanNodeHalos(relatedPks);
  createScanPathLines(pathEdges);
  state.scan = {
    startedAt: performance.now(),
    duration: SCAN_DURATION_MS,
    sourcePk,
    nodePks: relatedPks,
    edgeKeys: pathEdges,
  };
  pauseAutoRotate(SCAN_DURATION_MS + 900);
  const sourceMesh = nodeObjects.get(sourcePk);
  if (sourceMesh) {
    controls.target.copy(sourceMesh.position.clone().multiplyScalar(0.2));
    controls.update();
  }
  return {
    relatedCount: relatedIdentities.length,
    pathCount: pathEdges.size,
  };
}

function findRelatedIdentities(prompt, sourcePk) {
  const query = normalizeSearchText(prompt);
  const terms = query.split(/\s+/).filter((term) => term.length >= 2);
  const scored = graph.identities
    .filter((identity) => identity.pk !== sourcePk)
    .map((identity) => {
      const haystack = normalizeSearchText(
        [
          identity.code,
          identity.name,
          identity.email,
          identity.department,
          identity.jobTitle,
          identity.roleGroup,
          identity.accountRisk,
          identity.licensePlan,
          identity.mfaStatus,
          identity.accountStatus,
        ].join(' '),
      );
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? term.length : 0), 0);
      return { identity, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.identity.hierarchyDepth - b.identity.hierarchyDepth || a.identity.pk - b.identity.pk);

  if (scored.length > 0) return scored.slice(0, 8).map((item) => item.identity);

  const selected = employeesByPk.get(sourcePk);
  const fallbackPks = [
    ...(selected?.directReportPks || []),
    ...(selected?.subtreePks || []).filter((pk) => pk !== sourcePk),
    ...(selected?.managerChainPks || []),
  ];
  return [...new Set(fallbackPks)]
    .map((pk) => employeesByPk.get(pk))
    .filter(Boolean)
    .slice(0, 8);
}

function shortestOrgPath(sourcePk, targetPk) {
  if (sourcePk === targetPk) return [sourcePk];
  const queue = [sourcePk];
  const visited = new Set([sourcePk]);
  const previous = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of graphNeighborsByPk.get(current) || []) {
      if (visited.has(next)) continue;
      visited.add(next);
      previous.set(next, current);
      if (next === targetPk) {
        const path = [targetPk];
        let cursor = targetPk;
        while (previous.has(cursor)) {
          cursor = previous.get(cursor);
          path.unshift(cursor);
        }
        return path;
      }
      queue.push(next);
    }
  }

  return [sourcePk, targetPk];
}

function createScanWaves(sourcePk) {
  const sourceMesh = nodeObjects.get(sourcePk);
  const origin = sourceMesh?.position || new THREE.Vector3(0, 0, 0);
  [0, 0.18, 0.36].forEach((delay) => {
    const wave = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 32),
      new THREE.MeshBasicMaterial({
        color: SCAN_COLOR,
        transparent: true,
        opacity: 0.14,
        wireframe: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    wave.position.copy(origin);
    wave.userData = { type: 'scan-wave', delay };
    scanGroup.add(wave);
  });
}

function createGlobalBallFlash(color = SCAN_COLOR) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS * 1.04, 96, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  flash.userData = { type: 'global-ball-flash' };
  scanGroup.add(flash);
}

function createScanNodeHalos(nodePks, color = SCAN_COLOR) {
  nodePks.forEach((pk) => {
    const mesh = nodeObjects.get(pk);
    if (!mesh) return;
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(PERSON_RADIUS * 3.2, 32, 16),
      new THREE.MeshBasicMaterial({
        color: pk === state.selectedPk ? PATH_COLOR : color,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.position.copy(mesh.position);
    halo.userData = { type: 'scan-node-halo', pk };
    scanGroup.add(halo);
  });
}

function createScanPathLines(pathEdges, color = PATH_COLOR) {
  pathEdges.forEach((key) => {
    const [sourcePk, targetPk] = key.split(':').map(Number);
    const source = nodeObjects.get(sourcePk);
    const target = nodeObjects.get(targetPk);
    if (!source || !target) return;
    const line = makeLine(source.position, target.position, new THREE.Color(color), 0.92);
    line.userData = { type: 'scan-path-line', sourcePk, targetPk };
    scanGroup.add(line);
  });
}

function updateScanEffects(elapsed) {
  if (!state.scan) return;
  const progress = Math.min(1, (performance.now() - state.scan.startedAt) / state.scan.duration);
  const waveRadius = BALL_RADIUS * 1.08;

  scanGroup.children.forEach((object) => {
    if (object.userData.type === 'scan-wave') {
      const localProgress = Math.max(0, Math.min(1, (progress - object.userData.delay) / 0.64));
      const scale = 0.2 + localProgress * waveRadius;
      object.scale.setScalar(scale);
      object.material.opacity = Math.max(0, 0.18 * (1 - localProgress));
    }
    if (object.userData.type === 'global-ball-flash') {
      const flashProgress = Math.min(1, progress / 0.38);
      object.scale.setScalar(0.62 + flashProgress * 0.48);
      object.material.opacity = Math.max(0.04, 0.46 * (1 - flashProgress));
    }
    if (object.userData.type === 'scan-node-halo') {
      const pulse = 1 + Math.sin(elapsed * 7 + object.userData.pk * 0.17) * 0.22;
      object.scale.setScalar(pulse);
      object.material.opacity = 0.18 + Math.sin(elapsed * 5 + object.userData.pk * 0.11) * 0.06;
    }
    if (object.userData.type === 'scan-path-line') {
      object.material.opacity = 0.58 + Math.sin(elapsed * 8) * 0.28;
    }
  });

  if (progress >= 1) {
    clearScanEffects();
  }
}

function clearScanEffects() {
  const hadActiveScan = Boolean(state.scan);
  // Restore node materials from RAG glow
  if (state.scan?.nodePks) {
    state.scan.nodePks.forEach(function(pk) {
      var mesh = nodeObjects.get(pk);
      if (mesh && mesh.material && mesh.userData._origEmissive != null) {
        mesh.material.emissive.setHex(mesh.userData._origEmissive);
        mesh.material.emissiveIntensity = mesh.userData._origEmissiveIntensity;
        delete mesh.userData._origEmissive;
        delete mesh.userData._origEmissiveIntensity;
      }
    });
  }
  scanGroup.children.forEach((object) => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  scanGroup.clear();
  state.scan = null;
  if (hadActiveScan) {
    updateVisibility();
    resumeAutoRotate();
  }
}

function edgeKey(sourcePk, targetPk) {
  return [sourcePk, targetPk].sort((a, b) => a - b).join(':');
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._/-]+/gu, ' ')
    .trim();
}

function metricHtml(value, label) {
  return `<div class="metric"><strong>${Number(value).toLocaleString()}</strong><span>${escapeHtml(label)}</span></div>`;
}

function personOption(identity) {
  const label = `${identity.code} · ${identity.jobTitle} · ${identity.email}`;
  return `<option value="${identity.pk}">${escapeHtml(label)}</option>`;
}

function buildScene() {
  addLights();
  addGuides();
  addIdentityNodes();
  addReportingLines();
  window.addEventListener('resize', resize);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
}

function addLights() {
  scene.add(new THREE.AmbientLight('#ffffff', 1.7));
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(8, 10, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#4bb7ff', 1.8);
  rim.position.set(-8, -4, -6);
  scene.add(rim);
}

function addGuides() {
  addCosmicPointSphere();
  addAtmosphereShells();
  const sphereMaterial = new THREE.LineBasicMaterial({
    color: '#1e6ba8',
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  DEPTH_RADII.slice(1).forEach((radius, index) => {
    const ring = circleLine(radius, 0, 'horizontal', sphereMaterial);
    ring.rotation.x = (index % 2) * 0.04;
    scene.add(ring);
  });
  for (let i = 0; i < 8; i += 1) {
    const ring = circleLine(BALL_RADIUS, 0, 'vertical', sphereMaterial);
    ring.rotation.y = (Math.PI * i) / 8;
    scene.add(ring);
  }
}

function addAtmosphereShells() {
  const colors = ['#2dd4bf', '#38bdf8', '#818cf8', '#f0abfc'];

  DEPTH_RADII.slice(1).forEach((radius, index) => {
    const geometry = new THREE.SphereGeometry(radius, 64, 40);
    const material = new THREE.MeshBasicMaterial({
      color: colors[index % colors.length],
      transparent: true,
      opacity: 0.022 + index * 0.004,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const shell = new THREE.Mesh(geometry, material);
    shell.userData = { type: 'atmosphere-shell', level: index + 1, radius };
    scene.add(shell);
  });
}

function addCosmicPointSphere() {
  const count = 3200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i += 1) {
    const t = i / Math.max(count - 1, 1);
    const y = 1 - t * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * goldenAngle;
    const shellNoise = 0.9 + ((i * 9301 + 49297) % 233) / 2330;
    const radius = BALL_RADIUS * shellNoise;
    const x = Math.cos(theta) * radiusAtY * radius;
    const z = Math.sin(theta) * radiusAtY * radius;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = z;

    if (y > 0.42) color.set('#1f8cff');
    else if (y < -0.44) color.set('#ff6b24');
    else if (i % 7 === 0) color.set('#ffe066');
    else if (i % 5 === 0) color.set('#5df0a5');
    else color.set('#39a9ff');

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.032,
    vertexColors: true,
    transparent: true,
    opacity: 0.66,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.userData = { type: 'cosmic-shell' };
  scene.add(points);
}

function circleLine(radius, offset, orientation, material) {
  const points = [];
  for (let i = 0; i <= 160; i += 1) {
    const angle = (i / 160) * Math.PI * 2;
    if (orientation === 'horizontal') {
      points.push(new THREE.Vector3(Math.cos(angle) * radius, offset, Math.sin(angle) * radius));
    } else {
      points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
    }
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}

function addIdentityNodes() {
  graph.identities.forEach((identity) => {
    const department = departmentsByName.get(identity.department);
    const color = new THREE.Color(department?.color || '#6b7280');
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: isKeyIdentity(identity) ? 0.55 : 0.3,
      roughness: 0.28,
      metalness: 0.1,
      transparent: true,
      opacity: 0.94,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(PERSON_RADIUS, 20, 20), material);
    mesh.position.copy(identityPosition(identity));
    mesh.userData = {
      type: 'identity',
      identity,
      label: null,
    };
    scene.add(mesh);
    selectable.push(mesh);
    nodeObjects.set(identity.pk, mesh);

    const label = makeLabel(identityLabel(identity), isExecutiveIdentity(identity) ? 'executive-label' : '');
    label.position.set(0, PERSON_RADIUS + 0.24, 0);
    mesh.add(label);
    mesh.userData.label = label;

    if (identity.pk === graph.ceoPk) {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.65, 32, 32),
        new THREE.MeshBasicMaterial({
          color: '#63d8ff',
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
        }),
      );
      halo.position.copy(mesh.position);
      scene.add(halo);
    }
  });
}

function identityPosition(identity) {
  if (identity.pk === graph.ceoPk) return new THREE.Vector3(0, 0, 0);
  return positionSlotsByPk.get(identity.pk)?.clone() || new THREE.Vector3(0, 0, 0);
}

function seniorityScore(identity) {
  // 0 = most senior, higher = less senior
  let score = 0;
  if (identity.directReportCount > 0) score -= 3; // managers are senior
  if (identity.jobTitle && identity.jobTitle.includes('Senior')) score -= 2;
  if (identity.pk < 50) score -= 1; // lower employee code = earlier hire
  if (identity.jobTitle && (identity.jobTitle.includes('Junior') || identity.jobTitle.includes('Trainee'))) score += 2;
  // Add small random jitter to break ties
  score += seededUnit(identity.pk * 7 + 3) * 0.5;
  return score;
}

function interleaveByDepartment(identities) {
  const queues = graph.departments.map((department) =>
    identities
      .filter((identity) => identity.department === department.name)
      .sort((a, b) => a.hierarchyDepth - b.hierarchyDepth || a.pk - b.pk),
  );
  const unknownQueue = identities
    .filter((identity) => !departmentsByName.has(identity.department))
    .sort((a, b) => a.hierarchyDepth - b.hierarchyDepth || a.pk - b.pk);
  const ordered = [];
  let hasItems = true;

  while (hasItems) {
    hasItems = false;
    [...queues, unknownQueue].forEach((queue) => {
      const next = queue.shift();
      if (next) {
        ordered.push(next);
        hasItems = true;
      }
    });
  }

  return ordered;
}

function layerVolumeSlots(count, innerRadius, outerRadius, depth, seniorityRatios) {
  if (count <= 0) return [];
  if (count === 1) return [new THREE.Vector3(0, midpointRadius(innerRadius, outerRadius), 0)];

  const slots = [];
  const pairCount = Math.floor(count / 2);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const rotation = depth * 0.73;

  for (let i = 0; i < pairCount; i += 1) {
    const t = (i + 0.5) / pairCount;
    const y = 1 - t * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * goldenAngle + rotation;
    const sr = seniorityRatios ? seniorityRatios[i] : seededUnit(i * 97 + depth * 193);
    const radius = volumeRadius(innerRadius, outerRadius, sr, depth);
    const point = new THREE.Vector3(Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius);
    slots.push(point);
    slots.push(point.clone().multiplyScalar(-1));
  }

  if (count % 2 === 1) {
    const theta = rotation + Math.PI / 2;
    const radius = midpointRadius(innerRadius, outerRadius);
    slots.push(new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius));
  }

  return slots;
}

function volumeRadius(innerRadius, outerRadius, ratio, depth) {
  const padding = Math.min(0.18, (outerRadius - innerRadius) * 0.18);
  const minRadius = innerRadius + padding;
  const maxRadius = outerRadius - padding;
  const span = Math.max(0.01, maxRadius - minRadius);
  // ratio 0=inner(senior), 1=outer(junior). Blend: 70% seniority + 30% noise
  const noise = seededUnit(Math.round(ratio * 100) * 97 + depth * 193);
  const blended = ratio * 0.7 + noise * 0.3;
  return minRadius + span * blended;
}

function midpointRadius(innerRadius, outerRadius) {
  return (innerRadius + outerRadius) / 2;
}

function seededUnit(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function addReportingLines() {
  graph.reportingLinks.forEach((link) => {
    const source = nodeObjects.get(link.sourcePk);
    const target = nodeObjects.get(link.targetPk);
    if (!source || !target) return;
    const color = link.sourcePk === graph.ceoPk ? '#a9f0ff' : '#2f88c7';
    const opacity = link.sourcePk === graph.ceoPk ? 0.46 : 0.2;
    const line = makeLine(source.position, target.position, new THREE.Color(color), opacity);
    line.userData = {
      ...link,
      baseOpacity: opacity,
    };
    lineObjects.push(line);
    scene.add(line);
    addReportingFlowDots(line, source, target);
  });
}

function addReportingFlowDots(line, source, target) {
  const seed = (line.userData.sourcePk * 37 + line.userData.targetPk * 101) % 997;
  const forwardCount = 1 + (seed % 2);
  const returnCount = 1 + ((seed + 1) % 2);
  const flowDirections = [
    {
      direction: 1,
      count: forwardCount,
      colors: ['#7cf7ff', '#8ab4ff', '#5df0a5'],
      phase: 0,
    },
    {
      direction: -1,
      count: returnCount,
      colors: ['#ffd166', '#f0abfc', '#ff8fb3'],
      phase: 0.37,
    },
  ];

  flowDirections.forEach((flow) => {
    for (let index = 0; index < flow.count; index += 1) {
      const color = flow.colors[(seed + index * 2) % flow.colors.length];
      const size = 0.032 + ((seed + index * 11 + flow.direction * 3) % 5) * 0.006;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(size, 12, 8),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      dot.userData = {
        type: 'reporting-flow-dot',
        line,
        source,
        target,
        direction: flow.direction,
        offset: (index / flow.count + (seed % 17) / 17 + flow.phase) % 1,
        speed: 0.12 + ((seed + index * 5 + flow.count) % 8) * 0.015,
        pulse: seed * 0.013 + index + flow.phase * 10,
      };
      flowDotObjects.push(dot);
      scene.add(dot);
    }
  });
}

function makeLine(from, to, color, opacity) {
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const geometry = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  return new THREE.Line(geometry, material);
}

function makeLabel(text, className = '') {
  const element = document.createElement('div');
  element.className = `node-label ${className}`;
  element.textContent = text;
  return new CSS2DObject(element);
}

function identityLabel(identity) {
  const nick = shortPersonName(identity.name);
  const pos = shortJobTitle(identity.jobTitle);
  return `${nick} · ${pos}`;
}

function shortJobTitle(title) {
  if (!title) return '';
  const short = {
    'CEO / Managing Director': 'CEO',
    'Chief Operations Officer': 'COO',
    'Chief Financial Officer': 'CFO',
    'Chief Marketing Officer': 'CMO',
    'Executive Secretary to CEO': 'ExecSec',
  };
  if (short[title]) return short[title];
  return title.replace('Manager','Mgr').replace('Specialist','Spec').replace('Engineer','Eng')
    .replace('Officer','Off').replace('Consultant','Cons').replace('Coordinator','Coord')
    .replace('Architect','Arch').substring(0, 14);
}

function identityLabelCode(identity) {
  const roleCodes = {
    CEO: 'CEO',
    COO: 'COO',
    CFO: 'CFO',
  };
  if (roleCodes[identity.roleGroup]) return roleCodes[identity.roleGroup];
  return departmentCode(identity.department);
}

function departmentCode(value) {
  const codes = {
    'Customer Service & Warranty': 'CS/W',
    'Design & Architecture': 'D&A',
    'Engineering & Construction': 'E&C',
    Executive: 'EXEC',
    'Finance & Accounting': 'F&A',
    'HR & Admin': 'HR',
    IT: 'IT',
    Legal: 'LEG',
    Marketing: 'MKT',
    'Office Support': 'OPS',
    'Procurement & Warehouse': 'P&W',
    Sales: 'SALES',
  };
  return codes[value] || shortDept(value).toUpperCase();
}

function shortPersonName(value) {
  return String(value || '').trim().split(/\s+/)[0] || 'Unknown';
}

function displayLevel(identity) {
  if (identity.pk === graph.ceoPk) return 0;
  return visualDepth(identity);
}

function selectPerson(pk, moveCamera = true) {
  state.selectedPk = pk;
  personSelect.value = String(pk);
  const mesh = nodeObjects.get(pk);
  if (mesh && moveCamera) {
    pauseAutoRotate();
    controls.target.copy(mesh.position.clone().multiplyScalar(0.2));
    controls.update();
  }
  updateVisibility();
  renderDetail(employeesByPk.get(pk));
}

function updateVisibility() {
  const selected = employeesByPk.get(state.selectedPk);
  const chainSet = new Set([state.selectedPk, ...(selected?.managerChainPks || [])]);
  const subtreeSet = new Set(selected?.subtreePks || [state.selectedPk]);

  for (const [pk, mesh] of nodeObjects.entries()) {
    const identity = mesh.userData.identity;
    const departmentPass = state.department === 'ALL' || identity.department === state.department || pk === graph.ceoPk;
    const relationPass = state.lineMode !== 'subtree' || subtreeSet.has(pk) || chainSet.has(pk);
    const highlighted = chainSet.has(pk) || subtreeSet.has(pk);
    mesh.visible = departmentPass && relationPass;
    mesh.material.opacity = highlighted ? 0.98 : 0.5;
    mesh.scale.setScalar(pk === state.selectedPk ? 1.9 : highlighted ? 1.2 : 1);
    if (mesh.userData.label) {
      mesh.userData.label.visible = mesh.visible && shouldShowLabel(identity, highlighted);
    }
  }

  lineObjects.forEach((line) => {
    const sourceVisible = nodeObjects.get(line.userData.sourcePk)?.visible;
    const targetVisible = nodeObjects.get(line.userData.targetPk)?.visible;
    const inSelectedChain = chainSet.has(line.userData.sourcePk) && chainSet.has(line.userData.targetPk);
    const inSelectedSubtree = subtreeSet.has(line.userData.sourcePk) && subtreeSet.has(line.userData.targetPk);
    const modePass =
      state.lineMode === 'all' ||
      (state.lineMode === 'chain' && inSelectedChain) ||
      (state.lineMode === 'subtree' && (inSelectedSubtree || inSelectedChain));
    const visible = Boolean(sourceVisible && targetVisible && modePass);
    line.visible = visible;
    line.material.opacity = Math.min(0.68, (line.userData.baseOpacity || 0.18) * (inSelectedChain || inSelectedSubtree ? 2.4 : 1));
  });

  flowDotObjects.forEach((dot) => {
    dot.visible = dot.userData.line.visible;
  });

  updateMetricStrip();
}

function updateMetricStrip() {
  const visibleAccounts = Array.from(nodeObjects.values()).filter((mesh) => mesh.visible).length;
  const visibleLines = lineObjects.filter((line) => line.visible).length;
  metricStrip.innerHTML = [
    metricHtml(visibleAccounts, 'Visible accounts'),
    metricHtml(visibleLines, 'Visible lines'),
    metricHtml(graph.stats.oneDriveSiteCount, 'OneDrive sites'),
  ].join('');
}

function shouldShowLabel(identity, highlighted) {
  const depth = visualDepth(identity);
  if (depth > 0 && !state.visibleLabelDepths.has(depth)) return false;
  if (highlighted) return true;
  if (state.labelMode === 'all') return true;
  return isKeyIdentity(identity);
}

function isKeyIdentity(identity) {
  return identity.pk === graph.ceoPk || identity.directReportCount > 0 || isExecutiveIdentity(identity);
}

function isExecutiveIdentity(identity) {
  return ['CEO', 'COO', 'CFO', 'Head_of_Sales', 'Head_of_Construction'].includes(identity.roleGroup);
}

function visualDepth(identity) {
  if (identity.pk === graph.ceoPk) return 0;
  const hd = Number(identity.hierarchyDepth || 1);
  // Map: 1→1(C-Level inner), 2→2(Mgrs middle), 3→4(Staff outermost ring)
  if (hd >= 3) return 4;
  return Math.max(1, hd);
}

function renderDetail(identity) {
  if (!identity) return;
  const chain = [identity.pk, ...(identity.managerChainPks || [])]
    .map((pk) => employeesByPk.get(pk))
    .filter(Boolean)
    .map((item) => `${item.code} ${item.jobTitle}`)
    .join(' -> ');
  const directReports = identity.directReportPks
    .map((pk) => employeesByPk.get(pk))
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => `${item.code} ${item.name}`)
    .join(', ');

  const excelFile = `${identity.code}_OneDrive_Profile.xlsx`;
  const fileLink = `https://github.com/armkong33120/BuildersEye/blob/main/src/data/hr_onedrive_demo/${excelFile}`;

  detailPanel.innerHTML = `
    <div class="detail-title">${escapeHtml(identity.name)}</div>
    <div class="pill-row">
      <span class="pill">${escapeHtml(identity.code)}</span>
      <span class="pill">${escapeHtml(identity.department)}</span>
      <span class="pill">${escapeHtml(identity.accountRisk)}</span>
    </div>
    <div class="detail-grid">
      ${detailRow('Job Title', identity.jobTitle)}
      ${detailRow('Email', identity.email)}
      ${detailRow('📊 Excel Profile', `<a href="${fileLink}" target="_blank" class="excel-link">${excelFile}</a>`)}
      ${detailRow('Manager', identity.managerPk ? `${identity.managerCode} · ${identity.managerName}` : 'None')}
      ${detailRow('Reports To Chain', chain)}
      ${detailRow('Direct Reports', `${identity.directReportCount}${directReports ? ` · ${directReports}` : ''}`)}
      ${detailRow('License', identity.licensePlan)}
      ${detailRow('Mailbox Quota', `${identity.mailboxQuotaGb} GB`)}
      ${detailRow('OneDrive Quota', `${identity.oneDriveQuotaGb} GB`)}
      ${detailRow('MFA / Status', `${identity.mfaStatus} · ${identity.accountStatus}`)}
      ${detailRow('Last Directory Sync', identity.lastDirectorySync)}
    </div>
  `;
}

function detailRow(label, value) {
  return `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`;
}

function onPointerMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(selectable, false)[0];
  document.body.style.cursor = hit ? 'pointer' : 'default';
}

function onPointerDown(event) {
  pauseAutoRotate();
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(selectable, false)[0];
  if (hit?.object?.userData?.identity) {
    selectPerson(hit.object.userData.identity.pk);
  }
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const elapsed = performance.now() * 0.001;
  updateReportingFlowDots(elapsed);
  for (const [pk, mesh] of nodeObjects.entries()) {
    if (!mesh.visible) continue;
    const selectedPulse = pk === state.selectedPk ? 1 + Math.sin(elapsed * 2.4) * 0.035 : 1;
    // Stronger blink for RAG-matched nodes: scale bounce + emissive flicker
    const isRagMatch = state.scan?.nodePks?.has(pk) && state.scan?.mode === 'rag-search';
    const scanPulse = isRagMatch
      ? 1 + Math.sin(elapsed * 8 + pk * 0.17) * 0.22  // faster, stronger blink
      : (state.scan?.nodePks?.has(pk) ? 1 + Math.sin(elapsed * 7 + pk * 0.13) * 0.16 : 1);
    if (pk === state.selectedPk) mesh.scale.setScalar(1.9 * selectedPulse * scanPulse);
    else if (isRagMatch) mesh.scale.setScalar(1.45 * scanPulse);
    else if (state.scan?.nodePks?.has(pk)) mesh.scale.setScalar(1.35 * scanPulse);
    // Emissive pulse for RAG matches
    if (isRagMatch && mesh.material && mesh.userData._origEmissive != null) {
      mesh.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(elapsed * 8 + pk * 0.17)) * 0.9;
    }
  }
  updateScanEffects(elapsed);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function updateReportingFlowDots(elapsed) {
  flowDotObjects.forEach((dot) => {
    const { line, source, target, direction, offset, speed, pulse } = dot.userData;
    dot.visible = line.visible;
    if (!dot.visible) return;
    const progress = (offset + elapsed * speed) % 1;
    const t = direction === -1 ? 1 - progress : progress;
    dot.position.lerpVectors(source.position, target.position, t);
    const glow = 0.58 + Math.sin(elapsed * 5.5 + pulse) * 0.18;
    dot.material.opacity = Math.max(0.28, glow * Math.min(1, line.material.opacity + 0.44));
    dot.scale.setScalar(0.86 + Math.sin(elapsed * 7 + pulse) * 0.18);
  });
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function shortDept(value) {
  return value
    .replace(' & ', ' / ')
    .replace('Engineering and Construction', 'Engineering')
    .replace('Engineering & Construction', 'Engineering')
    .replace('Procurement and Warehouse', 'Procurement')
    .replace('Customer Service & Warranty', 'CS/Warranty')
    .replace('Design & Architecture', 'Design');
}
