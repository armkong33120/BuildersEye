// build-registry.js — CLI: สร้าง/อัปเดต employee registry จาก OneDrive cache
// ใช้: node build-registry.js [--force]
import 'dotenv/config';
import { buildRegistry } from './employeeRegistry.js';
import { getCacheDirSafe } from './runRegistry.js';

const force = process.argv.includes('--force');
const cacheDir = getCacheDirSafe();
console.log('🔄 Building employee registry...');
console.log('   cache:', cacheDir);
const t0 = Date.now();
const stats = buildRegistry(cacheDir, { force });
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ เสร็จใน ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(JSON.stringify({ ...stats, employeesFile: undefined, schemaFile: undefined }, null, 2));
