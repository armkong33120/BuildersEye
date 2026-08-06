import 'dotenv/config';
// --- Application Insights (optional): เปิดอัตโนมัติเมื่อมี connection string (Azure) ---
if (process.env.APPINSIGHTS_CONNECTION_STRING) {
  try {
    const ai = (await import('applicationinsights')).default;
    ai.setup(process.env.APPINSIGHTS_CONNECTION_STRING)
      .setAutoCollectRequests(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectPerformance(true, true)
      .setSendLiveMetrics(true)
      .start();
    console.log('[appinsights] connected');
  } catch (e) {
    console.warn('[appinsights] init failed (continuing without it):', e.message);
  }
}
import express from 'express';
import cors from 'cors';
import { ingestAll } from './ingestExcel.js';
import { initDatabase } from './sqlEngine.js';
import { buildVectorIndex } from './vectorEngine.js';
import { chatHandler } from './chatController.js';
import { listConversations, getConversation, addMessage, deleteConversation } from './conversationStore.js';
import { seedUsers, login as authLogin, refresh as authRefresh, logout as authLogout, verifyAccessToken, previewCredentials } from './authStore.js';
import { buildRegistry, getActiveEmployees, getEmployee, getSchema } from './employeeRegistry.js';
import { registryToFlatIndex, buildScopeCodes } from './registryIngest.js';
import { getCacheDirSafe } from './runRegistry.js';
import { isConfigured as odConfigured, listAccounts, syncAll } from './onedriveSync.js';
import { searchVectors, vectorsExist, getVectorMeta } from './vectorStore.js';
import { embedOne } from './localEmbedder.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5199;

let flatIndex = [];
let searchIndex = new Map();
let identityGraph = null;
let indexReady = false;
let startupTime = null;
let dataSource = 'unknown';   // 'registry' | 'files'
let lastRegistryStats = null;

// โหลดข้อมูลจาก Employee Registry (OneDrive-driven) — fallback เป็นไฟล์เดิมถ้า registry ว่าง
function loadDataRegistryFirst() {
  try {
    const cacheDir = getCacheDirSafe();
    const stats = buildRegistry(cacheDir); // incremental: ไฟล์ไม่เปลี่ยนข้ามเร็วมาก
    const employees = getActiveEmployees();
    if (employees.length > 0) {
      const { flatIndex: fi, searchIndex: si } = registryToFlatIndex(employees);
      lastRegistryStats = stats;
      return { flatIndex: fi, searchIndex: si, source: 'registry', count: employees.length };
    }
  } catch (e) {
    console.warn('[registry] build failed, falling back to file ingest:', e.message);
  }
  return null;
}

// legacy path: อ่าน Excel จากโฟลเดอร์โดยตรง (เดิม)
function loadDataFromFiles() {
  let dataDir = process.env.HR_DATA_DIR;
  if (dataDir) {
    dataDir = path.resolve(dataDir);
    if (!fs.existsSync(dataDir)) dataDir = null;
  }
  if (!dataDir) {
    const oneDrivePath = path.join(
      process.env.HOME || '/Users/arm',
      'Library/CloudStorage/OneDrive-UbonRatchathaniUniversity/BuildersEye HR Demo Dataset/Employees'
    );
    dataDir = fs.existsSync(oneDrivePath)
      ? oneDrivePath
      : path.join(__dirname, '..', 'src', 'data', 'hr_onedrive_demo');
  }
  const result = ingestAll(dataDir);
  return { flatIndex: result.flatIndex, searchIndex: result.searchIndex, source: 'files', count: result.totalFiles };
}

// hot-reload: เรียกหลัง sync/rebuild → swap index + re-init DB (chat/search ใช้ข้อมูลใหม่ทันที)
function reloadData(reason = 'manual') {
  const start = Date.now();
  const loaded = loadDataRegistryFirst() || loadDataFromFiles();
  flatIndex = loaded.flatIndex;
  searchIndex = loaded.searchIndex;
  dataSource = loaded.source;
  initDatabase(flatIndex);
  console.log(`[reload:${reason}] source=${dataSource} records=${flatIndex.length} tokens=${searchIndex.size} in ${Date.now() - start}ms`);
  return { source: dataSource, records: flatIndex.length, employees: loaded.count };
}

async function startup() {
  console.log('[ingest] Starting data load (registry-first)...');
  const start = Date.now();
  // cloud boot: ถ้าไม่มี vectors ในเครื่อง ลองดึงจาก Azure Blob (ephemeral filesystem)
  try {
    const { ensureVectorsFromBlob } = await import('./blobSync.js');
    await ensureVectorsFromBlob();
  } catch (e) {
    console.warn('[blob] ensureVectors skipped:', e.message);
  }
  const loaded = loadDataRegistryFirst() || loadDataFromFiles();
  flatIndex = loaded.flatIndex;
  searchIndex = loaded.searchIndex;
  dataSource = loaded.source;
  console.log(`[ingest] Done via ${dataSource}: ${loaded.count} employees, ${flatIndex.length} records, ${searchIndex.size} tokens in ${Date.now() - start}ms`);

  // Load identity graph
  const graphPath = path.join(__dirname, '..', 'src', 'data', 'identity-graph.json');
  try {
    const raw = fs.readFileSync(graphPath, 'utf-8');
    identityGraph = JSON.parse(raw);
  } catch (e) {
    console.warn('[ingest] Could not load identity-graph.json:', e.message);
  }

  initDatabase(flatIndex);
  // Seed user accounts from identity graph (M6) — idempotent
  try {
    const count = seedUsers(identityGraph);
    console.log(`[auth] Users ready: ${count} accounts`);
  } catch (e) {
    console.warn('[auth] seedUsers failed:', e.message);
  }
  // Vector index is memory-heavy (60k embeddings). Disable on low-RAM hosts via VECTOR_INDEX_DISABLED=true
  if (process.env.VECTOR_INDEX_DISABLED !== 'true') {
    try {
      buildVectorIndex(flatIndex);
    } catch (e) {
      console.warn('[vector] buildVectorIndex skipped (err):', e.message);
    }
  } else {
    console.log('[vector] VECTOR_INDEX_DISABLED=true, skipping vector index build');
  }
  indexReady = true;
  startupTime = new Date().toISOString();
}

const app = express();
// CORS: allow local dev + Vercel/cloud frontend origins (from env CORS_ORIGINS, comma-separated)
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5174,http://localhost:5173,https://builders-eye.vercel.app')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));

// --- Authentication (M1: JWT primary, legacy APP_API_KEY fallback for transition) ---
const EXPECTED_API_KEY = process.env.APP_API_KEY || '';

function requireAuth(req, res, next) {
  const authz = req.headers.authorization || '';
  const provided =
    (req.headers['x-api-key']) ||
    (authz.startsWith('Bearer ') ? authz.slice(7) : '');

  if (!provided) {
    return res.status(401).json({ error: 'Unauthorized: missing credentials' });
  }

  // 1) Try JWT access token (per-user role)
  const user = verifyAccessToken(provided);
  if (user) {
    req.authUser = user;
    req.viewer = { role: user.role, employeeId: user.employeeId };
    return next();
  }

  // 2) Legacy static API key (transition). Role falls back to server env / request body.
  if (EXPECTED_API_KEY && provided === EXPECTED_API_KEY) {
    req.authUser = null; // legacy shared key — no per-user identity
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized: invalid credentials' });
}

// Server-defined viewer role (legacy fallback only). With JWT, role comes from the token.
const VALID_ROLES = ['CEO', 'HR', 'Manager', 'Employee'];
const DEFAULT_ROLE = VALID_ROLES.includes(process.env.APP_VIEWER_ROLE)
  ? process.env.APP_VIEWER_ROLE
  : 'CEO';

function resolveViewer(req) {
  // JWT-authenticated: role/employeeId are signed in the token — never trust client body.
  if (req.viewer && VALID_ROLES.includes(req.viewer.role)) {
    return { role: req.viewer.role, employeeId: req.viewer.employeeId };
  }
  // Legacy API-key path: accept requested role or fall back to server default.
  const requestedRole = req.body?.viewer?.role;
  const role = VALID_ROLES.includes(requestedRole) ? requestedRole : DEFAULT_ROLE;
  const empId = Number(req.body?.viewer?.employeeId);
  return { role, employeeId: Number.isFinite(empId) && empId > 0 ? empId : 1 };
}

app.get('/api/health', (req, res) => {
  const uniqueFiles = new Set(flatIndex.filter(r => r.sheetName === 'Employee_Profile').map(r => r.fileName));
  res.json({
    status: 'ok', uptime: process.uptime(),
    indexedFiles: uniqueFiles.size, indexReady,
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    startupTime,
  });
});

app.get('/api/index/status', (req, res) => {
  const uniqueFiles = new Set(flatIndex.map(r => r.fileName));
  const uniqueEmps = new Set(flatIndex.map(r => r.employeeId));
  res.json({
    totalEmployees: uniqueEmps.size, totalFiles: uniqueFiles.size,
    totalRecords: flatIndex.length, totalTokens: searchIndex.size,
    indexReady, startupTime,
  });
});

// --- Auth routes (M1) ---
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
    const result = authLogin(username, password, req.ip);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Login failed' });
  }
});

app.post('/api/auth/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    const result = authRefresh(refreshToken);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Refresh failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    res.json(authLogout(refreshToken));
  } catch (e) {
    res.json({ success: true });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  if (!req.authUser) return res.status(200).json({ legacy: true, viewer: req.viewer || null });
  res.json(req.authUser);
});

// Preview credentials (M4) — enabled only when ENABLE_TEST_CREDS=true
app.get('/api/preview/credentials', (req, res) => {
  const creds = previewCredentials();
  if (!creds) return res.status(403).json({ error: 'Preview credentials disabled' });
  res.json(creds);
});

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { query, conversationId } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const viewer = resolveViewer(req);

    // Save user message to conversation history
    const convId = conversationId || 'conv-' + Date.now();
    addMessage(convId, 'user', query);

    const result = await chatHandler(query, viewer, { flatIndex, searchIndex, identityGraph }, convId);

    // Save assistant response
    if (result.answer) {
      addMessage(convId, 'assistant', result.answer);
    }

    // Include conversationId in response
    result.conversationId = convId;
    res.json(result);
  } catch (e) {
    console.error('[chat] Error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Conversation history ---
app.get('/api/conversations', requireAuth, (req, res) => {
  res.json(listConversations());
});

app.get('/api/conversations/:id', requireAuth, (req, res) => {
  const convo = getConversation(req.params.id);
  if (!convo) return res.status(404).json({ error: 'Conversation not found' });
  res.json(convo);
});

app.delete('/api/conversations/:id', requireAuth, (req, res) => {
  const ok = deleteConversation(req.params.id);
  res.json({ success: ok });
});

// ===================== Employee Registry API (OneDrive-driven) =====================
const LAST_SYNC_FILE = path.join(__dirname, '.data', 'onedrive', 'last-sync.json');
function readLastSync() {
  try { return JSON.parse(fs.readFileSync(LAST_SYNC_FILE, 'utf-8')); } catch { return null; }
}
function writeLastSync(obj) {
  try { fs.mkdirSync(path.dirname(LAST_SYNC_FILE), { recursive: true }); fs.writeFileSync(LAST_SYNC_FILE, JSON.stringify(obj, null, 2)); } catch {}
}

function requirePrivileged(req, res) {
  const viewer = resolveViewer(req);
  if (viewer.role !== 'CEO' && viewer.role !== 'HR') {
    res.status(403).json({ error: 'Forbidden: CEO/HR only' });
    return null;
  }
  return viewer;
}

function empSummary(e) {
  return {
    code: e.code, pk: e.pk, name: e.name, department: e.department,
    jobTitle: e.jobTitle, roleGroup: e.roleGroup, managerCode: e.managerCode,
    status: e.status, employmentStatus: e.employmentStatus,
    sheetCount: (e.sheetNames || []).length, lastSeen: e.lastSeen,
  };
}

app.get('/api/registry/status', requireAuth, (req, res) => {
  const employees = getActiveEmployees();
  const schema = getSchema();
  res.json({
    dataSource,
    indexReady,
    startupTime,
    activeEmployees: employees.length,
    registryStats: lastRegistryStats,
    schemaSheets: Object.keys(schema.sheets || {}).length,
    schemaUpdatedAt: schema.updatedAt || null,
    onedrive: {
      configured: odConfigured(),
      accounts: odConfigured() ? listAccounts() : [],
      lastSync: readLastSync(),
    },
    vectors: { built: vectorsExist(), meta: getVectorMeta() },
  });
});

app.get('/api/registry/employees', requireAuth, (req, res) => {
  const viewer = resolveViewer(req);
  const employees = getActiveEmployees();
  const scope = buildScopeCodes(viewer, employees);
  const visible = scope ? employees.filter(e => scope.has(e.code)) : employees;
  res.json({ viewer: { role: viewer.role, employeeId: viewer.employeeId }, count: visible.length, employees: visible.map(empSummary) });
});

app.get('/api/registry/employees/:code', requireAuth, (req, res) => {
  const viewer = resolveViewer(req);
  const employees = getActiveEmployees();
  const emp = getEmployee(req.params.code);
  if (!emp || emp.status !== 'active') return res.status(404).json({ error: 'Employee not found' });
  const scope = buildScopeCodes(viewer, employees);
  if (scope && !scope.has(emp.code)) return res.status(403).json({ error: 'Forbidden: outside your scope' });

  const privileged = viewer.role === 'CEO' || viewer.role === 'HR';
  const schema = getSchema();
  const sheets = {};
  for (const [sn, sd] of Object.entries(emp.sheets || {})) {
    const sensitive = schema.sheets?.[sn]?.sensitivity === 'sensitive';
    sheets[sn] = (sensitive && !privileged)
      ? { redacted: true, reason: 'sensitive sheet — CEO/HR only', rowCount: (sd.records || []).length }
      : sd;
  }
  res.json({ ...empSummary(emp), email: emp.email, managerName: emp.managerName, profileHeaders: emp.profileHeaders, sheets });
});

app.get('/api/registry/schema', requireAuth, (req, res) => {
  if (!requirePrivileged(req, res)) return;
  res.json(getSchema());
});

// กด sync ด้วยมือ (CEO/HR): OneDrive delta sync → rebuild registry → hot-reload engines
app.post('/api/sync/onedrive', requireAuth, async (req, res) => {
  if (!requirePrivileged(req, res)) return;
  const result = { synced: null, registry: null, reload: null };
  try {
    if (odConfigured()) {
      result.synced = await syncAll(() => {});
    } else {
      result.synced = { skipped: 'OneDrive not configured — rebuild from local cache only' };
    }
    result.registry = buildRegistry(getCacheDirSafe());
    result.reload = reloadData('sync-api');
    writeLastSync({ at: new Date().toISOString(), by: req.authUser?.username || 'api', result: { active: result.registry.activeEmployees } });
    res.json(result);
  } catch (e) {
    console.error('[sync-api] Error:', e.message);
    res.status(500).json({ error: e.message, partial: result });
  }
});

// ===================== Semantic + Hybrid Search (local embeddings — สมอง B) =====================
app.post('/api/search/semantic', requireAuth, async (req, res) => {
  try {
    const { query, k = 5, sheet = null, mode = 'vector', hyde = false, rerank = false } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query is required' });
    const viewer = resolveViewer(req);
    const employees = getActiveEmployees();
    const scope = buildScopeCodes(viewer, employees);
    const allowSensitive = viewer.role === 'CEO' || viewer.role === 'HR';
    const kk = Math.min(Number(k) || 5, 20);

    // --- HyDE (optional): ขยายคำถามเป็นคำตอบจำลองก่อน embed ---
    let embedText = query;
    let hydeText = null;
    if (hyde) {
      const { hydeExpand } = await import('./llmRerank.js');
      hydeText = await hydeExpand(query);
      if (hydeText) embedText = `${query}\n${hydeText}`;
    }

    // --- vector results (ถ้ามี) ---
    let vectorResults = [];
    if (vectorsExist()) {
      const qv = await embedOne(embedText, { isQuery: true });
      const out = await searchVectors(qv, { k: mode === 'hybrid' ? 25 : kk, scopeCodes: scope, allowSensitive, sheet });
      vectorResults = out.results || [];
    } else if (mode === 'vector') {
      return res.status(503).json({ error: 'Vector index not built yet — run: npm run build:vectors' });
    }

    // --- fuse หรือใช้ vector ล้วน ---
    let payload;
    if (mode === 'hybrid') {
      const { hybridFuse } = await import('./hybridSearch.js');
      payload = hybridFuse(query, flatIndex, searchIndex, vectorResults, { k: kk });
    } else {
      payload = { mode: hydeText ? 'vector+hyde' : 'vector', results: vectorResults };
    }

    // --- LLM rerank (optional) ---
    if (rerank && payload.results.length) {
      const { llmRerank } = await import('./llmRerank.js');
      const rr = await llmRerank(query, payload.results, { topN: 10 });
      payload.results = rr.results;
      payload.reranked = rr.reranked;
    }

    res.json({ query, hyde: hydeText, viewer: { role: viewer.role }, ...payload });
  } catch (e) {
    console.error('[semantic] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===================== Auto-sync รายวัน (ไม่ใช้ dep เพิ่ม) =====================
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;      // เช็คทุก 30 นาที
const AUTO_SYNC_STALE_MS = 24 * 60 * 60 * 1000;    // เกิน 24 ชม.ถือว่าข้อมูลค้าง
function startAutoSync() {
  if (process.env.AUTO_SYNC_DISABLED === 'true') return console.log('[autosync] disabled by env');
  if (!odConfigured()) return console.log('[autosync] OneDrive not configured — scheduler off (local data only)');
  setInterval(async () => {
    try {
      const last = readLastSync();
      const age = last?.at ? Date.now() - new Date(last.at).getTime() : Infinity;
      if (age < AUTO_SYNC_STALE_MS) return;
      console.log('[autosync] data stale (>24h) — running daily sync...');
      await syncAll(() => {});
      buildRegistry(getCacheDirSafe());
      const r = reloadData('autosync');
      writeLastSync({ at: new Date().toISOString(), by: 'autosync', result: r });
      console.log('[autosync] done:', JSON.stringify(r));
    } catch (e) {
      console.warn('[autosync] failed (will retry next tick):', e.message);
    }
  }, AUTO_SYNC_INTERVAL_MS);
  console.log('[autosync] scheduler on (check every 30m, sync when >24h stale)');
}

const reindex = process.argv.includes('--reindex');
if (reindex) {
  await startup();
  console.log('[index] Reindex complete. Exiting.');
  console.log(JSON.stringify({ totalFiles: new Set(flatIndex.map(r => r.fileName)).size, totalRecords: flatIndex.length, totalTokens: searchIndex.size }));
  process.exit(0);
}

await startup();
app.listen(PORT, () => {
  console.log(`[server] BuildersEye RAG backend on http://localhost:${PORT}`);
  console.log(`[server] Health: http://localhost:${PORT}/api/health`);
  console.log(`[server] Chat: POST http://localhost:${PORT}/api/chat`);
  startAutoSync();
});
