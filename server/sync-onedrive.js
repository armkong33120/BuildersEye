// sync-onedrive.js — CLI สั่ง sync ไฟล์จาก OneDrive ทุกบัญชี (รันใน terminal ได้เลย)
// ใช้: node sync-onedrive.js
import 'dotenv/config';
import { syncAll, listAccounts, getCacheDir } from './onedriveSync.js';

console.log('🔄 OneDrive Sync เริ่ม...');
console.log('บัญชีที่จะ sync:', JSON.stringify(listAccounts(), null, 2));
console.log('━'.repeat(50));

const start = Date.now();
try {
  const result = await syncAll(console.log);
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log('━'.repeat(50));
  console.log(`✅ เสร็จใน ${secs}s — ไฟล์ใน cache: ${result.cacheFileCount}`);
  console.log(`   cache dir: ${result.cacheDir}`);
  const fails = result.results.filter(r => !r.ok);
  if (fails.length) {
    console.log(`⚠️ ล้มเหลว ${fails.length} รายการ:`);
    fails.forEach(f => console.log(`   - ${f.account}/${f.folder}: ${f.error}`));
  }
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}