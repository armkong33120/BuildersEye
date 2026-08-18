import 'dotenv/config';
import { getAuditLogs, logAuditActivity } from '../server/auditStore.js';

async function run() {
  console.log("Writing test log...");
  await logAuditActivity({
    username: 'testuser',
    role: 'tester',
    query: 'hello',
    status: 'Allowed',
    answerLength: 100,
    route: 'llm',
    ip: '127.0.0.1'
  });
  console.log("Reading logs...");
  const logs = await getAuditLogs();
  console.log("Logs:", logs);
  process.exit(0);
}
run();
