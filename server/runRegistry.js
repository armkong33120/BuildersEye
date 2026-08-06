// runRegistry.js — glue: หา cache dir จาก onedriveSync หรือ fallback เป็น local demo data
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getCacheDirSafe() {
  // 1) OneDrive cache (sync จริง)
  const odCache = path.join(__dirname, '.data', 'onedrive', 'cache');
  if (fs.existsSync(odCache) && fs.readdirSync(odCache).some(f => /\.xlsx$/i.test(f))) return odCache;
  // 2) fallback: local demo data (เผื่อยังไม่ได้ sync)
  const local = path.join(__dirname, '..', 'src', 'data', 'hr_onedrive_demo');
  if (fs.existsSync(local)) return local;
  return odCache; // คืนค่า default ให้ error ชัดเจน
}
