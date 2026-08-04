import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ingestAll } from './ingestExcel.js';
import { initDatabase } from './sqlEngine.js';
import { buildVectorIndex } from './vectorEngine.js';
import { chatHandler } from './chatController.js';
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

async function startup() {
  console.log('[ingest] Starting Excel ingestion...');
  const start = Date.now();

  // Data directory priority:
  // 1. HR_DATA_DIR env var (used on Render/cloud deployments)
  // 2. OneDrive path (local dev on this machine)
  // 3. Repo-local demo copy (always present in repo)
  let dataDir = process.env.HR_DATA_DIR;
  if (dataDir) {
    console.log(`[ingest] Using HR_DATA_DIR env: ${dataDir}`);
    dataDir = path.resolve(dataDir);
    if (!fs.existsSync(dataDir)) {
      console.warn('[ingest] HR_DATA_DIR path not found, falling back to OneDrive/local copy');
      dataDir = null;
    }
  }

  if (!dataDir) {
    const oneDrivePath = path.join(
      process.env.HOME || '/Users/arm',
      'Library/CloudStorage/OneDrive-UbonRatchathaniUniversity/BuildersEye HR Demo Dataset/Employees'
    );

    dataDir = oneDrivePath;
    if (!fs.existsSync(dataDir)) {
      console.warn('[ingest] OneDrive path not found, using local copy');
      dataDir = path.join(__dirname, '..', 'src', 'data', 'hr_onedrive_demo');
    }
  }

  try {
    const result = ingestAll(dataDir);
    flatIndex = result.flatIndex;
    searchIndex = result.searchIndex;
    console.log(`[ingest] Done: ${result.totalFiles} files, ${flatIndex.length} records, ${searchIndex.size} tokens in ${Date.now() - start}ms`);
  } catch (e) {
    console.error('[ingest] Failed:', e.message);
    const fallback = path.join(__dirname, '..', 'src', 'data', 'hr_onedrive_demo');
    console.log('[ingest] Trying fallback:', fallback);
    const result = ingestAll(fallback);
    flatIndex = result.flatIndex;
    searchIndex = result.searchIndex;
    console.log(`[ingest] Fallback: ${result.totalFiles} files, ${flatIndex.length} records`);
  }

  // Load identity graph
  const graphPath = path.join(__dirname, '..', 'src', 'data', 'identity-graph.json');
  try {
    const raw = fs.readFileSync(graphPath, 'utf-8');
    identityGraph = JSON.parse(raw);
  } catch (e) {
    console.warn('[ingest] Could not load identity-graph.json:', e.message);
  }

  initDatabase(flatIndex);
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
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5174,http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  const uniqueFiles = new Set(flatIndex.filter(r => r.sheetName === 'Employee_Profile').map(r => r.fileName));
  res.json({
    status: 'ok', uptime: process.uptime(),
    indexedFiles: uniqueFiles.size, indexReady,
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    startupTime,
  });
});

// TEMP diagnostic: report LLM availability + env config (no secrets) + test a DeepSeek call
app.get('/api/debug-llm', async (req, res) => {
  const { isLLMAvailable, getClient } = await import('./llmClient.js');
  const info = {
    llmAvailable: isLLMAvailable(),
    hasLLMKey: Boolean(process.env.LLM_API_KEY),
    hasDeepSeekKey: Boolean(process.env.DEEPSEEK_API_KEY),
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    llmBaseUrl: process.env.LLM_BASE_URL || '(default api.deepseek.com)',
    llmModel: process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'deepseek-chat',
    llmSkip: process.env.LLM_SKIP,
  };
  // Try a real call
  try {
    const { generateAnswer } = await import('./llmClient.js');
    const r = await generateAnswer('say hi', 'test', { rawSql: false });
    info.directCall = { ok: true, result: r };
  } catch (e) {
    info.directCall = { ok: false, error: e.message };
  }
  res.json(info);
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

app.post('/api/chat', async (req, res) => {
  try {
    const { query, viewer, conversationId } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const result = await chatHandler(query, viewer || { role: 'CEO', employeeId: 1 }, { flatIndex, searchIndex, identityGraph }, conversationId || '');
    res.json(result);
  } catch (e) {
    console.error('[chat] Error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
});
