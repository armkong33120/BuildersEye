// connect-onedrive.js — CLI เชื่อมบัญชี OneDrive เข้าระบบ sync (รันครั้งเดียวต่อบัญชี)
// ใช้: node connect-onedrive.js <label> <folder1> [folder2...]
// ตัวอย่าง: node connect-onedrive.js account-a BuildersEye_Account_A
import 'dotenv/config';
import { connectAccount, listAccounts, isConfigured } from './onedriveSync.js';

const [label, ...folders] = process.argv.slice(2);

if (!isConfigured()) {
  console.error('❌ ยังไม่ได้ตั้ง AZURE_CLIENT_ID ใน .env');
  process.exit(1);
}
if (!label || folders.length === 0) {
  console.log('ใช้: node connect-onedrive.js <label> <folder1> [folder2...]');
  console.log('ตัวอย่าง: node connect-onedrive.js account-a BuildersEye_Account_A');
  console.log('\nบัญชีที่เชื่อมแล้ว:', JSON.stringify(listAccounts(), null, 2));
  process.exit(0);
}

console.log(`\n🔐 กำลังเชื่อมบัญชี "${label}" (folders: ${folders.join(', ')})...`);
console.log('━'.repeat(50));

try {
  const result = await connectAccount(label, folders, (msg) => {
    console.log('\n' + msg + '\n');
    console.log('━'.repeat(50));
  });
  console.log(`✅ เชื่อมสำเร็จ: ${result.username}`);
  console.log(`   folders: ${result.folders.join(', ')}`);
  console.log('\nขั้นต่อไป: node -e "import(\'./onedriveSync.js\').then(m=>m.syncAll()).then(r=>console.log(JSON.stringify(r,null,2)))"');
} catch (e) {
  console.error('❌ เชื่อมไม่สำเร็จ:', e.message);
  process.exit(1);
}