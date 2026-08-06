// onedriveSync.js — Microsoft Graph OneDrive sync (Delegated OAuth + Delta Query)
// จำลอง "พนักงานแชร์ไฟล์บน OneDrive" → ระบบดึงไฟล์ที่เปลี่ยนมาไว้ local cache แล้ว ingest
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PublicClientApplication } from '@azure/msal-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_DIR = path.join(__dirname, '.data', 'onedrive');
const CACHE_DIR = path.join(STORE_DIR, 'cache');
const STATE_FILE = path.join(STORE_DIR, 'state.json');
const MSAL_CACHE_FILE = path.join(STORE_DIR, 'msal-cache.json');

for (const d of [STORE_DIR, CACHE_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const TENANT_ID = process.env.AZURE_TENANT_ID || 'common';
const SCOPES = ['Files.Read', 'offline_access', 'User.Read'];

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { accounts: [] }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function createPCA() {
  return new PublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    },
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (ctx) => {
          if (fs.existsSync(MSAL_CACHE_FILE)) {
            ctx.tokenCache.deserialize(fs.readFileSync(MSAL_CACHE_FILE, 'utf-8'));
          }
        },
        afterCacheAccess: async (ctx) => {
          if (ctx.cacheHasChanged) {
            fs.writeFileSync(MSAL_CACHE_FILE, ctx.tokenCache.serialize(), 'utf-8');
          }
        },
      },
    },
  });
}

export function isConfigured() { return Boolean(CLIENT_ID); }

export function listAccounts() {
  return loadState().accounts.map(a => ({
    label: a.label, username: a.username, folders: a.folders, connectedAt: a.connectedAt,
  }));
}

export function getCacheDir() { return CACHE_DIR; }
// เชื่อมบัญชีด้วย device code (เรียกจาก CLI)
export async function connectAccount(label, folders, onMessage) {
  const pca = createPCA();
  const result = await pca.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (resp) => onMessage(resp.message),
  });
  const state = loadState();
  state.accounts = state.accounts.filter(a => a.label !== label);
  state.accounts.push({
    label,
    username: result.account.username,
    homeAccountId: result.account.homeAccountId,
    folders,
    deltaLinks: {},
    connectedAt: new Date().toISOString(),
  });
  saveState(state);
  return { username: result.account.username, folders };
}

// ดึง access token แบบ silent จาก cache (re-export ให้ webhook/สมัคร subscription ใช้)
export async function getAccessToken(homeAccountId) {
  const pca = createPCA();
  const accounts = await pca.getTokenCache().getAllAccounts();
  const account = accounts.find(a => a.homeAccountId === homeAccountId);
  if (!account) throw new Error('account not found in cache — reconnect needed');
  const result = await pca.acquireTokenSilent({ scopes: SCOPES, account });
  return result.accessToken;
}

async function graphGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error('token expired/invalid — reconnect needed');
  if (res.status === 429 || res.status >= 500) {
    const wait = Number(res.headers.get('Retry-After') || 2);
    await new Promise(r => setTimeout(r, wait * 1000));
    const retry = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!retry.ok) throw new Error(`Graph ${retry.status} after retry`);
    return retry;
  }
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text().catch(() => '')}`);
  return res;
}

// sync 1 โฟลเดอร์ของ 1 บัญชี: ดาวน์โหลดเฉพาะไฟล์ที่เปลี่ยน (delta)
async function syncFolder(account, folderName, log) {
  const token = await getAccessToken(account.homeAccountId);
  const encoded = encodeURIComponent(folderName);
  let url = account.deltaLinks?.[folderName]
    || `https://graph.microsoft.com/v1.0/me/drive/root:/${encoded}:/delta`;

  let downloaded = 0, deleted = 0;

  while (url) {
    const res = await graphGet(token, url);
    const data = await res.json();

    for (const item of data.value || []) {
      if (!item.file) continue;                            // ข้ามโฟลเดอร์
      if (!/^EMP\d{3}.*\.xlsx$/i.test(item.name)) continue; // เฉพาะไฟล์พนักงาน
      const localPath = path.join(CACHE_DIR, item.name);

      if (item.deleted) {
        if (fs.existsSync(localPath)) { fs.unlinkSync(localPath); deleted++; }
        continue;
      }
      const dl = await graphGet(token, `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/content`);
      const buf = Buffer.from(await dl.arrayBuffer());
      fs.writeFileSync(localPath, buf);
      downloaded++;
    }

    url = data['@odata.nextLink'] || null;
    if (data['@odata.deltaLink']) {
      account.deltaLinks[folderName] = data['@odata.deltaLink'];
    }
  }

  log(`[${account.label}/${folderName}] downloaded=${downloaded} deleted=${deleted}`);
  return { downloaded, deleted };
}

// sync ทุกบัญชี × ทุกโฟลเดอร์
export async function syncAll(log = console.log) {
  if (!isConfigured()) throw new Error('AZURE_CLIENT_ID not configured');
  const state = loadState();
  if (state.accounts.length === 0) throw new Error('no OneDrive accounts connected — run connect-onedrive.js first');

  const results = [];
  for (const account of state.accounts) {
    for (const folder of account.folders) {
      try {
        const r = await syncFolder(account, folder, log);
        results.push({ account: account.label, folder, ok: true, ...r });
      } catch (e) {
        log(`[${account.label}/${folder}] ERROR: ${e.message}`);
        results.push({ account: account.label, folder, ok: false, error: e.message });
      }
    }
  }
  saveState(state);
  const files = fs.readdirSync(CACHE_DIR).filter(f => /^EMP\d{3}.*\.xlsx$/i.test(f));
  return { results, cacheFileCount: files.length, cacheDir: CACHE_DIR, syncedAt: new Date().toISOString() };
}
