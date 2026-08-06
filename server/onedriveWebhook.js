// onedriveWebhook.js — Realtime Sync ผ่าน Microsoft Graph Change Notification
// หลักการ: สร้าง subscription ต่อบัญชี → Graph ชน webhook มา ACA เมื่อไฟล์เปลี่ยน
// → ACA sync delta ทันที → rebuild registry → reload engines → token กลับไปเก็บ Neon
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OD_DIR = path.join(__dirname, '.data', 'onedrive');
const MSAL_FILE = path.join(OD_DIR, 'msal-cache.json');
const STATE_FILE = path.join(OD_DIR, 'state.json');
const WEBHOOK_SECRET = process.env.WEBHOOK_CLIENT_STATE || 'builderseye-realtime-sync';

export const WEBHOOK_PATH = '/api/webhook/onedrive';

async function poolQuery(text, params = []) {
  const { getPool } = await import('./neonStore.js');
  return getPool().query(text, params);
}

// cloud boot: ไม่มี token local → เอามาจาก Neon (อุปนิสัย: privacy = มีเฉพาะใน DB ของเรา + Azure)
export async function seedTokensFromNeon(log = console.log) {
  if (!process.env.DATABASE_URL) return { seeded: false };
  if (!fs.existsSync(OD_DIR)) fs.mkdirSync(OD_DIR, { recursive: true });
  let changed = false;
  if (!fs.existsSync(MSAL_FILE)) {
    const r = await poolQuery(`SELECT value FROM onedrive_tokens WHERE key='msal'`);
    if (r.rows.length) { fs.writeFileSync(MSAL_FILE, r.rows[0].value); changed = true; }
  }
  if (!fs.existsSync(STATE_FILE)) {
    const r = await poolQuery(`SELECT value FROM onedrive_tokens WHERE key='state'`);
    if (r.rows.length) { fs.writeFileSync(STATE_FILE, r.rows[0].value); changed = true; }
  }
  if (changed) log('[webhook] tokens seeded from Neon');
  return { seeded: changed };
}

// หลัง sync (token อาจ refresh) → เก็บกลับขึ้น Neon
export async function pushTokensToNeon(log = console.log) {
  if (!process.env.DATABASE_URL) return;
  try {
    const msal = fs.existsSync(MSAL_FILE) ? fs.readFileSync(MSAL_FILE, 'utf-8') : null;
    const state = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf-8') : null;
    if (msal) await poolQuery(`INSERT INTO onedrive_tokens (key,value) VALUES ('msal',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [msal]);
    if (state) await poolQuery(`INSERT INTO onedrive_tokens (key,value) VALUES ('state',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [state]);
  } catch (e) {
    log('[webhook] pushTokens failed:', e.message);
  }
}

// ----- สร้าง/ต่ออายุ subscription ต่อบัญชี -----
async function getAccountTokens() {
  const { listAccounts } = await import('./onedriveSync.js');
  const { getAccessToken } = await import('./onedriveTokens.js');
  const accounts = listAccounts();
  const out = [];
  for (const a of accounts) {
    try { out.push({ ...a, token: await getAccessToken(a.homeAccountId) }); }
    catch (e) { console.warn(`[webhook] get token ${a.label} fail:`, e.message); }
  }
  return out;
}

async function graphRequest(token, url, options = {}) {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function createSubscription(account) {
  const notifyUrl = process.env.PUBLIC_BACKEND_URL + WEBHOOK_PATH;
  const expiration = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(); // ~2 วัน (OneDrive สูงสุด ~3 วัน)
  const body = {
    changeType: 'updated',
    notificationUrl: notifyUrl,
    resource: '/me/drive/root',
    expirationDateTime: expiration,
    clientState: WEBHOOK_SECRET,
  };
  // ดึงไดรฟ์ id จริงของบัญชี (ใช้ /me/drive/root ได้เฉพาะ token ของบัญชีนั้น — เราคือเจ้าของเอง)
  return graphRequest(account.token, 'https://graph.microsoft.com/v1.0/subscriptions', { method: 'POST', body });
}

export async function ensureSubscriptions(log = console.log) {
  if (!process.env.PUBLIC_BACKEND_URL || !process.env.WEBHOOK_CLIENT_STATE) {
    log('[webhook] ensureSubscriptions skip: missing PUBLIC_BACKEND_URL/WEBHOOK_CLIENT_STATE');
    return [];
  }
  const accounts = await getAccountTokens();
  const status = [];
  for (const acct of accounts) {
    try {
      const created = await createSubscription(acct);
      status.push({ username: acct.username, subscriptionId: created.id, expires: created.expirationDateTime });
      log(`[webhook] subscription created for ${acct.username} → ${created.id}`);
    } catch (e) {
      log(`[webhook] create subscription ${acct.username} failed: ${e.message}`);
    }
  }
  return status;
}

// ----- handler สำหรับ express -----
export async function handleWebhook(req, res, { onNotify } = {}) {
  // 1) การยืนยันจาก Microsoft (ตอนสร้าง/เปลี่ยน subscription): response ต้องคืน validationToken
  if (req.query && req.query.validationToken) {
    res.set('Content-Type', 'text/plain');
    return res.send(String(req.query.validationToken));
  }

  // 2) notification จริง — ตอบ 202 ไว แล้วทำงาน async ข้างหลัง
  const notifications = req.body?.value || [];
  if (notifications.length) {
    res.status(202).send('Accepted');
    // ตรวจ clientState (กันปลอม)
    const valid = notifications.filter(n => !n.clientState || n.clientState === WEBHOOK_SECRET);
    if (valid.length && onNotify) {
      setImmediate(() => {
        onNotify(valid)
          .then(r => console.log('[webhook] handled:', JSON.stringify(r)))
          .catch(e => console.error('[webhook] onNotify failed:', e.message));
      });
    }
    return;
  }
  res.status(200).send('ok');
}
