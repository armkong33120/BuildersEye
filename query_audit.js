import { getPool } from './server/neonStore.js';
import 'dotenv/config';

async function run() {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM audit_logs');
    console.log("Rows in DB:", rows.length);
    console.log(rows);
  } catch (e) {
    console.log("Error:", e.message);
  }
  process.exit(0);
}
run();
