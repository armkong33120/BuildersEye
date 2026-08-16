// migrate_access_model.mjs — One-time migration: seed the normalized access
// model from the legacy identity graph (or registry employees).
//
// Maps legacy roles → access profiles (CEO→GLOBAL_ADMIN, HR→HR_PRIVILEGED,
// Manager→TEAM_MANAGER, Employee→SELF_ONLY) via the compatibility adapter.
// Idempotent — never overwrites existing admin edits.
//
// Usage: node scripts/migrate_access_model.mjs
// (also runs automatically at backend startup — this script is for explicit,
// auditable one-time migration.)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = path.join(__dirname, '..', 'src', 'data', 'identity-graph.json');

const { seedAccessModel, getProfiles, getPolicies, getEmployees } = await import('../server/access/index.js');

let identityGraph = null;
try {
  identityGraph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8'));
} catch (e) {
  console.warn('[migrate] identity-graph.json not found — will seed profiles/policies only:', e.message);
}

const result = seedAccessModel({ identityGraph });

console.log('✅ Access model migration complete:');
console.log(`   profiles:   ${result.profiles} (${getProfiles().map(p => p.profileCode).join(', ')})`);
console.log(`   policies:   ${result.policies}`);
console.log(`   employees:  ${result.employees}`);
console.log(`   data dir:   ${process.env.ACCESS_DATA_DIR || 'server/.data/access'}`);
console.log('\nLegacy role → access profile mapping applied (derived, not stored).');
console.log('Run `node scripts/test_access_model.mjs` to verify the model.');
