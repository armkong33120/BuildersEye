import 'dotenv/config';
import fs from 'fs';
import { saveSourceLinksNeon, preloadAccessCache } from './access/accessStoreNeon.js';

async function run() {
  await preloadAccessCache(); // Ensure connection and cache init
  const links = JSON.parse(fs.readFileSync('./.data/access/source_links.json', 'utf8'));
  console.log(`Pushing ${links.length} source links to Neon...`);
  await saveSourceLinksNeon(links);
  console.log('Done!');
  process.exit(0);
}
run();
