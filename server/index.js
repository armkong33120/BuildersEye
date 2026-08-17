import 'dotenv/config';
// --- Application Insights: ต้องเป็น import แรกสุด (patch http ก่อน express โหลด ไม่งั้นเก็บข้อมูลไม่ได้) ---
import { trackAudit, flushAudit } from './appInsightsSetup.js';
import express from 'express';
import cors from 'cors';
import { ingestAll } from './ingestExcel.js';
import { initDatabase } from './sqlEngine.js';
import { buildVectorIndex } from './vectorEngine.js';
import { chatHandler, getPipelineLatencyStats } from './chatController.js';
import { normalizeScore } from './score.js';
import { listConversations, getConversation, addMessage, deleteConversation } from './conversationStore.js';
import { seedUsers, login as authLogin, refresh as authRefresh, logout as authLogout, verifyAccessToken, previewCredentials, listOnlineUsers } from './authStore.js';
import { buildRegistry, getActiveEmployees, getEmployee, getSchema } from './employeeRegistry.js';
import { registryToFlatIndex } from './registryIngest.js';
import { getCacheDirSafe } from './runRegistry.js';
import { isConfigured as odConfigured, listAccounts, syncAll } from './onedriveSync.js';
import { handleWebhook, seedTokensFromNeon, pushTokensToNeon, ensureSubscriptions, WEBHOOK_PATH } from './onedriveWebhook.js';
import { searchVectors, vectorsExist, getVectorMeta, isVectorIndexStale } from './vectorStore.js';
import { embedOne } from './localEmbedder.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { seedAccessModel, buildOrgSnapshot, resolveAccess, resolveViewerScope, getProfilesMap, getEmployees as getAccessEmployees, getRelationships as getAccessRelationships, getPolicyVersion } from './access/index.js';
import { mountAdminRoutes } from './adminRoutes.js';

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
// Guard against concurrent vector rebuilds (embedding is slow/expensive).
let vectorRebuildInFlight = false;

function reloadData(reason = 'manual') {
  const start = Date.now();
  const loaded = loadDataRegistryFirst() || loadDataFromFiles();
  flatIndex = loaded.flatIndex;
  searchIndex = loaded.searchIndex;
  dataSource = loaded.source;
  initDatabase(flatIndex);
  console.log(`[reload:${reason}] source=${dataSource} records=${flatIndex.length} tokens=${searchIndex.size} in ${Date.now() - start}ms`);

  // Data freshness: after an org change (sync/webhook/manual), the keyword index
  // is rebuilt above; the vector index must also be rebuilt so deactivated/moved
  // employees' stale chunks are dropped. Rebuild is async (embedding is slow) and
  // skipped when the embedder is unavailable (cloud) — retrieval still enforces
  // scope at query time, so stale chunks are never served to unauthorized users.
  try {
    if (!vectorRebuildInFlight && process.env.VECTOR_INDEX_DISABLED !== 'true' && isVectorIndexStale()) {
      vectorRebuildInFlight = true;
      import('./rebuildVectors.js')
        .then(({ rebuildVectors }) => rebuildVectors({ log: (m) => console.log(m) }))
        .then((r) => console.log(`[reload:${reason}] vectors rebuilt: ${r.total} chunks in ${r.ms}ms`))
        .catch((e) => console.warn(`[reload:${reason}] vector rebuild skipped: ${e.message}`))
        .finally(() => { vectorRebuildInFlight = false; });
    }
  } catch (e) {
    console.warn(`[reload:${reason}] staleness check failed: ${e.message}`);
  }

  return { source: dataSource, records: flatIndex.length, employees: loaded.count };
}

async function startup() {
  console.log('[ingest] Starting data load (registry-first)...');
  const start = Date.now();
  // cloud boot: ดึง registry จาก Neon (ถาวร) ถ้ายังไม่มี local cache
  try {
    if (process.env.DATABASE_URL && !fs.existsSync(path.join(__dirname, '.data', 'registry', 'employees.json'))) {
      const { pullRegistryFromNeon } = await import('./neonSync.js');
      await pullRegistryFromNeon();
    }
  } catch (e) {
    console.warn('[neon] pull skipped:', e.message);
  }
  // cloud boot: seed OneDrive token จาก Neon (เพื่อ webhook ได้ sync เอง) + สมัคร webhook subscription
  try {
    if (process.env.DATABASE_URL) {
      await seedTokensFromNeon();
      const { isConfigured } = await import('./onedriveSync.js');
      if (isConfigured() && process.env.PUBLIC_BACKEND_URL) {
        await ensureSubscriptions();
        // ต่ออายุ subscription ทุก 12 ชม. (OneDrive หมดอายุ ~3 วัน)
        setInterval(async () => {
          try { await ensureSubscriptions(() => {}); } catch (e) { console.warn('[webhook] renew failed:', e.message); }
        }, 12 * 60 * 60 * 1000);
      }
    }
  } catch (e) {
    console.warn('[webhook] setup skipped:', e.message);
  }
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
  // Seed the normalized access model (profiles/policies/employees) from the
  // identity graph. Idempotent; derives accessProfile from legacy role.
  try {
    const accessSeed = seedAccessModel({ identityGraph });
    console.log(`[access] Model seeded: ${accessSeed.profiles} profiles, ${accessSeed.policies} policies, ${accessSeed.employees} employees`);
  } catch (e) {
    console.warn('[access] seedAccessModel failed:', e.message);
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

// --- Authentication (JWT only — legacy APP_API_KEY removed after transition) ---
const VALID_ROLES = ['CEO', 'HR', 'Manager', 'Employee'];

function requireAuth(req, res, next) {
  const authz = req.headers.authorization || '';
  const provided = authz.startsWith('Bearer ') ? authz.slice(7) : '';

  if (!provided) {
    return res.status(401).json({ error: 'Unauthorized: missing credentials' });
  }

  // JWT access token only (per-user role/employeeId are signed — never trust client body).
  const user = verifyAccessToken(provided);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: invalid credentials' });
  }
  req.authUser = user;
  req.viewer = { role: user.role, employeeId: user.employeeId };
  return next();
}

// Viewer role comes solely from the signed JWT. Fallback below is server-side only
// (safe for internal calls); it never reads req.body.
function resolveViewer(req) {
  if (req.viewer && VALID_ROLES.includes(req.viewer.role)) {
    return { role: req.viewer.role, employeeId: req.viewer.employeeId };
  }
  return { role: 'Employee', employeeId: 0 };
}

// Resolve the authorized scope for a viewer via the CANONICAL resolver.
// Org snapshot = current registry (Excel/OneDrive truth) overlaid with admin
// relationships; profile = admin-assigned accessProfile (fallback legacy role).
// Returns resolveAccess result: { scopeCodes (null|Set), profileCode, viewerCode,
// allowed, ... }. This single boundary feeds retrieval/SQL/vector/cache.
function resolveScopeForViewer(viewer) {
  return resolveViewerScope(viewer, {
    employees: getActiveEmployees(),
    relationships: getAccessRelationships(),
    profiles: getProfilesMap(),
  });
}

// requireAdmin: requires JWT auth AND admin authorization. Use AFTER requireAuth.
// Source of truth is the access profile (GLOBAL_ADMIN has isAdmin=true), NOT the
// request body and NOT the legacy role string alone.
function isAdminAuthorized(authUser) {
  if (!authUser) return false;
  // Once the access model is seeded, the access profile permission is
  // AUTHORITATIVE: a profile-based admin revocation (e.g. GLOBAL_ADMIN →
  // SELF_ONLY) takes effect even if the legacy role string still says CEO, and
  // an unknown user (no access record) is denied by default.
  const accessModelSeeded = getAccessEmployees().length > 0;
  if (accessModelSeeded) {
    const accessEmp = getAccessEmployees().find((e) => e.employeeId === Number(authUser.employeeId));
    if (!accessEmp) return false; // seeded model, unknown user → deny-by-default
    const profile = accessEmp.accessProfile ? getProfilesMap().get(accessEmp.accessProfile) : null;
    return profile?.permissions?.isAdmin === true;
  }
  // Legacy role fallback ONLY while the access model is not seeded yet
  // (pre-migration deployments / startup window before seedAccessModel runs).
  return authUser.role === 'CEO' || authUser.isAdmin === true;
}

function requireAdmin(req, res, next) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Unauthorized: authentication required' });
  }
  if (!isAdminAuthorized(req.authUser)) {
    return res.status(403).json({ error: 'Forbidden: admin access only' });
  }
  return next();
}

// Admin-only configuration API (read + write separated). Mounted under
// /api/admin/* with requireAuth + requireAdmin enforced on every route. The
// dataSource provides org data so the "Preview As User" endpoint evaluates the
// selected user's scope against the real registry snapshot.
mountAdminRoutes(app, {
  requireAuth,
  requireAdmin,
  dataSource: {
    getActiveEmployees,
    getAccessRelationships,
    getProfilesMap,
  },
});

app.get('/api/health', (req, res) => {
  const uniqueFiles = new Set(flatIndex.filter(r => r.sheetName === 'Employee_Profile').map(r => r.fileName));
  res.json({
    status: indexReady ? 'ok' : 'warming', uptime: process.uptime(),
    indexedFiles: uniqueFiles.size, indexReady,
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    startupTime,
  });
});

// ระหว่าง warm-up: บอก client ให้ retry แทนที่จะ error ประหลาดๆ
function requireReady(req, res, next) {
  if (!indexReady) {
    res.set('Retry-After', '5');
    return res.status(503).json({ error: 'warming', message: 'เซิร์ฟเวอร์กำลังตื่น — ลองอีกครั้งในไม่กี่วินาที', retryAfterSec: 5 });
  }
  next();
}

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
app.post('/api/auth/login', requireReady, async (req, res) => {
  const t0 = Date.now();
  const { username, password } = req.body || {};
  try {
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
    const result = await authLogin(username, password, req.ip);
    trackAudit('login_ok', { user: username, ip: req.ip, durationMs: Date.now() - t0, role: result.user?.role });
    res.json(result);
  } catch (e) {
    trackAudit('login_fail', { user: username, ip: req.ip, status: e.status || 500, reason: e.message });
    res.status(e.status || 500).json({ error: e.message || 'Login failed' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    const result = await authRefresh(refreshToken);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Refresh failed' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    res.json(await authLogout(refreshToken));
  } catch (e) {
    res.json({ success: true });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  if (!req.authUser) return res.status(200).json({ legacy: true, viewer: req.viewer || null });
  res.json(req.authUser);
});

// Preview credentials (M4) — enabled only when ENABLE_TEST_CREDS=true
// SECURITY: requires valid JWT auth (prevents unauthenticated user enumeration).
app.get('/api/preview/credentials', requireAuth, (req, res) => {
  const creds = previewCredentials();
  if (!creds) return res.status(403).json({ error: 'Preview credentials disabled' });
  res.json(creds);
});

// Latest chat pipeline result — consumed by the debug neural-network page.
// H1 isolation: keyed by authenticated userId (JWT sub) + invalidation version,
// so a user can only ever read/write their OWN last chat pipeline. A pipeline
// from another user is unreachable by changing an id.
const latestPipelineByUser = new Map(); // userId -> { ...pipeline, policyVersion }

app.post('/api/chat', requireAuth, requireReady, async (req, res) => {
  try {
    const { conversationId } = req.body || {};
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ error: 'query is required' });
    const viewer = resolveViewer(req);

    // Viewer identity comes SOLELY from the signed JWT (req.authUser) — never
    // from req.body.viewer. This is what the UI displays (username/role/
    // employeeId/department), so the client cannot spoof who it is.
    const viewerInfo = req.authUser ? {
      username: req.authUser.username,
      role: req.authUser.role,
      employeeId: req.authUser.employeeId,
      department: req.authUser.dept || '',
      name: req.authUser.name || '',
    } : null;

    // Save user message to conversation history. Owner is the JWT user id (H2);
    // a body-supplied conversationId owned by another user throws 403 here.
    // conversationStore.addMessage signature is (id, role, text, title, userId) —
    // the 5th arg is the owner; earlier calls wrongly passed the owner as `title`.
    const convId = conversationId || 'conv-' + Date.now();
    addMessage(convId, 'user', query, undefined, req.authUser.id);

    // Canonical authorized scope (single boundary) — flows into keyword, vector
    // (pre-retrieval), and SQL (scoped table) paths inside chatHandler.
    const access = resolveScopeForViewer(viewer);
    const result = await chatHandler(query, viewer, { flatIndex, searchIndex, identityGraph, scope: access, access }, convId);

    // Stable id shared by the direct chat response AND latestPipeline so the
    // debug page can deduplicate history (live polling must not double-record).
    const pipelineId = 'pl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

    // Serve the assistant pipeline ONLY to its own owner. The entry also records
    // the policy version at write time so stale perms are never served (M4): if
    // the policy changed since this query, drop the stale entry.
    latestPipelineByUser.set(req.authUser.id, {
      ...({
        id: pipelineId,
        query: result.query,
        answer: result.answer,
        chunks: (result.results || []).slice(0, 5).map((r) => ({
          s: normalizeScore(r.score != null ? r.score : (r.matchedRecords && r.matchedRecords[0] ? 0.5 : 0)),
          t: (r.matchedRecords && r.matchedRecords[0] && r.matchedRecords[0].content) || (r.employeeId ? 'EMP' + String(r.employeeId).padStart(3, '0') : ''),
        })),
        sources: (result.sources || []).slice(0, 5),
        matchedEmployeePks: result.matchedEmployeePks || [],
        matchedDepartments: result.matchedDepartments || [],
        responseTimeMs: result.responseTimeMs || 0,
        at: Date.now(),
        trace: result.trace || [],
        llmUsed: !!result.llmUsed,
        sqlUsed: !!result.sqlUsed,
        sqlDetected: !!result.sqlDetected,
        sqlAttempted: !!result.sqlAttempted,
        sqlSucceeded: !!result.sqlSucceeded,
        fallbackRoute: result.fallbackRoute || null,
        answerSource: result.answerSource || 'template',
        route: result.route || 'template',
        provider: result.provider || null,
        model: result.model || null,
        executedNodes: result.executedNodes || 0,
        uniqueExecutedNodes: result.uniqueExecutedNodes || 0,
        executedEntries: result.executedEntries || 0,
        totalNodes: result.totalNodes || 0,
        retrievalEvidence: result.retrievalEvidence || [],
        sqlEvidence: result.sqlEvidence || null,
        matchersUsed: result.matchersUsed || [],
        cached: !!result.cached,
        viewer: viewerInfo,
      }),
      policyVersion: getPolicyVersion(),
    });

    // Save assistant response (owner = JWT user id, 5th arg of addMessage)
    if (result.answer) {
      addMessage(convId, 'assistant', result.answer, undefined, req.authUser.id);
    }

    // Include conversationId + identity in the direct response
    result.conversationId = convId;
    result.id = pipelineId;
    result.viewer = viewerInfo;
    result.role = viewerInfo?.role || null;
    result.employeeId = viewerInfo?.employeeId ?? null;
    result.department = viewerInfo?.department || null;
    res.json(result);
  } catch (e) {
    console.error('[chat] Error:', e.message);
    // Respect route-level errors (e.g. 403 conversation-ownership) while never
    // leaking internal error details for unexpected/internal failures.
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error' });
  }
});

// Debug pipeline inspector — returns the latest chat retrieval data for the
// AUTHENTICATED user ONLY (H1). SECURITY: requires valid JWT auth.
app.get('/api/debug/pipeline', requireAuth, (req, res) => {
  const entry = latestPipelineByUser.get(req.authUser.id);
  if (!entry) return res.status(404).json({ error: 'No pipeline data yet' });
  // M4: if the policy version changed since this pipeline was produced, it is
  // stale (may reflect old permissions). Drop and refuse to serve it.
  if (entry.policyVersion !== getPolicyVersion()) {
    latestPipelineByUser.delete(req.authUser.id);
    return res.status(404).json({ error: 'No pipeline data yet' });
  }
  const { policyVersion, ...pipeline } = entry;
  res.json(pipeline);
});

// Debug online users — who is currently logged in (active sessions).
// M1 isolation: this no longer exposes ALL active users to any authenticated
// user. Admins may see the full list; non-admin users only see themselves.
app.get('/api/debug/online', requireAuth, async (req, res) => {
  const users = await listOnlineUsers();
  if (isAdminAuthorized(req.authUser)) {
    res.json({ count: users.length, users });
  } else {
    const self = users.filter((u) => u.username === req.authUser.username);
    res.json({ count: self.length, users: self });
  }
});

// Debug latency stats — p50/p95 pipeline + LLM latencies
app.get('/api/debug/latency', requireAuth, (req, res) => {
  const pipelineStats = getPipelineLatencyStats();
  // Lazy-import LLM latency to avoid circular dep
  import('./llmClient.js').then(({ getLLMLatencyStats }) => {
    const llmStats = getLLMLatencyStats();
    res.json({ pipeline: pipelineStats, llm: llmStats });
  }).catch(() => {
    res.json({ pipeline: pipelineStats, llm: null });
  });
});

// --- Conversation history (H2 isolation: owner = JWT user id) ---
// Get only conversations owned by the authenticated user.
app.get('/api/conversations', requireAuth, (req, res) => {
  res.json(listConversations(req.authUser.id));
});

// Return a conversation ONLY if it belongs to the requester. A conversation
// owned by another user is indistinguishable from a missing one (404).
app.get('/api/conversations/:id', requireAuth, (req, res) => {
  const convo = getConversation(req.params.id, req.authUser.id);
  if (!convo) return res.status(404).json({ error: 'Conversation not found' });
  res.json(convo);
});

// Delete a conversation only if it belongs to the requester.
app.delete('/api/conversations/:id', requireAuth, (req, res) => {
  const ok = deleteConversation(req.params.id, req.authUser.id);
  if (!ok) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ success: true });
});

// ===================== OneDrive Realtime Webhook (Microsoft Graph Change Notification) =====================
// POST {backend}/api/webhook/onedrive — Graph ตอกมาเมื่อไฟล์เปลี่ยน → sink delta ทันที
app.post(WEBHOOK_PATH, (req, res) => {
  handleWebhook(req, res, {
    onNotify: async () => {
      const syncRes = await syncAll(() => {});
      const registry = buildRegistry(getCacheDirSafe());
      const reload = reloadData('webhook');
      await pushTokensToNeon();
      return { synced: syncRes.downloaded ?? syncRes.syncedAt, registryActive: registry.activeEmployees, reload: reload.source };
    },
  });
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
  // M2: the connected OneDrive account identity (accounts list) is only exposed
  // to admins. Non-admin authenticated users get a configured flag only — never
  // the account metadata (userPrincipalName / account identity).
  const isAdmin = isAdminAuthorized(req.authUser);
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
      accounts: isAdmin ? (odConfigured() ? listAccounts() : []) : [],
      lastSync: isAdmin ? readLastSync() : null,
    },
    vectors: { built: vectorsExist(), meta: getVectorMeta(), stale: isVectorIndexStale() },
  });
});

app.get('/api/registry/employees', requireAuth, (req, res) => {
  const viewer = resolveViewer(req);
  const employees = getActiveEmployees();
  const scope = resolveScopeForViewer(viewer).scopeCodes;
  const visible = scope ? employees.filter(e => scope.has(e.code)) : employees;
  res.json({ viewer: { role: viewer.role, employeeId: viewer.employeeId }, count: visible.length, employees: visible.map(empSummary) });
});

app.get('/api/registry/employees/:code', requireAuth, (req, res) => {
  const viewer = resolveViewer(req);
  const employees = getActiveEmployees();
  const emp = getEmployee(req.params.code);
  if (!emp || emp.status !== 'active') return res.status(404).json({ error: 'Employee not found' });
  // L1: sensitive-redaction decision comes from the canonical access profile
  // (GLOBAL_ADMIN/HR_PRIVILEGED → canSeeSensitive), not the legacy role string,
  // so authorization authority stays consistent with the policy engine.
  const access = resolveScopeForViewer(viewer);
  const scope = access.scopeCodes;
  if (scope && !scope.has(emp.code)) return res.status(403).json({ error: 'Forbidden: outside your scope' });

  const privileged = !!access.accessProfile?.permissions?.canSeeSensitive;
  const schema = getSchema();
  const sheets = {};
  for (const [sn, sd] of Object.entries(emp.sheets || {})) {
    const sensitive = schema.sheets?.[sn]?.sensitivity === 'sensitive';
    sheets[sn] = (sensitive && !privileged)
      ? { redacted: true, reason: 'sensitive sheet — access profile lacks permission', rowCount: (sd.records || []).length }
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
    await pushTokensToNeon();
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
    const access = resolveScopeForViewer(viewer);
    const scope = access.scopeCodes;
    // L1: allowSensitive derives from the canonical access profile permission,
    // not the legacy role string, so the vector gate matches the policy engine.
    const allowSensitive = !!access.accessProfile?.permissions?.canSeeSensitive;
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
      const whoBias = /ใคร|คนไหน|บุคคล|ใครคือ|บุคคลใด/.test(query);
      // Layer 2 — sheet-mention detection → sheetBias + coverage guarantee
      const { detectSheetMentions } = await import('./sheetAliases.js');
      const sheetMentions = detectSheetMentions(query);
      const sheetBoost = Number(process.env.RAG_SHEET_BOOST || 1.10);
      const sheetCoverage = Number(process.env.RAG_SHEET_COVERAGE || 2);
      const qv = await embedOne(embedText, { isQuery: true });
      const out = await searchVectors(qv, { k: mode === 'hybrid' ? 25 : kk, scopeCodes: scope, allowSensitive, sheet, whoBias, sheetMentions, sheetBoost, coverage: sheetCoverage });
      vectorResults = out.results || [];
      req._sheetMentions = sheetMentions;
    } else if (mode === 'vector') {
      return res.status(503).json({ error: 'Vector index not built yet — run: npm run build:vectors' });
    }

    // --- fuse หรือใช้ vector ล้วน ---
    let payload;
    if (mode === 'hybrid') {
      const { hybridFuse } = await import('./hybridSearch.js');
      const sheetMentions = req._sheetMentions || null;
      const maxShare = Number(process.env.RAG_SHEET_MAX_SHARE || 4);
      payload = hybridFuse(query, flatIndex, searchIndex, vectorResults, { k: kk, sheetMentions, maxSharePerSheet: maxShare, scopeCodes: scope });
    } else {
      payload = { mode: hydeText ? 'vector+hyde' : 'vector', available: true, results: vectorResults };
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

// ฟังพอร์ตก่อนทันที (ตอบ health ได้ใน 1-3 วิ) แล้วค่อย warm ข้อมูลใน background
// → cold start ที่ผู้ใช้รับรู้สั้นลงมาก (ingress เจอ listener ทันที ไม่ connection refused)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] BuildersEye RAG backend listening on http://0.0.0.0:${PORT}`);
  console.log(`[server] Health: http://localhost:${PORT}/api/health`);
  console.log(`[server] Chat: POST http://localhost:${PORT}/api/chat`);
  startAutoSync();
});

// flush telemetry บน shutdown (กัน App Insights ตัด data กลางคัน)
['SIGTERM', 'SIGINT'].forEach(sig => {
  process.on(sig, () => {
    try { flushAudit(); } catch (e) { /* noop */ }
    process.exit(0);
  });
});

// warm-up ใน background — routes ที่ต้องใช้ข้อมูลจะถูก guard ด้วย indexReady (ตอบ 503 warming ให้ client retry)
startup().catch(e => console.error('[startup] failed:', e.message));
