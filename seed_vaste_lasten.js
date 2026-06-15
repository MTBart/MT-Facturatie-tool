#!/usr/bin/env node
/**
 * seed_vaste_lasten.js
 * Laadt C:\MT\data\vaste-lasten.json in Worker KV (TRACK_KV) als 'cfg:vaste-lasten'.
 *
 * Uitrolstap 1 uit de checklist — eenmalig draaien VOOR wrangler deploy.
 * Vereist: wrangler 4.x geinstalleerd en geauthenticeerd.
 *
 * Gebruik:
 *   node seed_vaste_lasten.js
 *
 * Veiligheid: dit script schrijft GEEN secrets of PII naar de repo.
 * vaste-lasten.json staat al in .gitignore.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname);
const DATA_FILE = path.join(REPO_ROOT, 'data', 'vaste-lasten.json');

// KV-namespace-id uit wrangler.toml (TRACK_KV)
// Wrangler 4.x: wrangler kv key put --namespace-id=<id> <key> <value>
const KV_NAMESPACE_ID = 'c2ccdda50c59470d99ca885acecaff20';
const KV_KEY = 'cfg:vaste-lasten';

if (!fs.existsSync(DATA_FILE)) {
  console.error('FOUT: Bestand niet gevonden:', DATA_FILE);
  console.error('Maak eerst C:\\MT\\data\\vaste-lasten.json aan (staat al in .gitignore).');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  console.error('FOUT: vaste-lasten.json is geen geldige JSON:', e.message);
  process.exit(1);
}

const value = JSON.stringify(data);
console.log(`Laden: ${DATA_FILE}`);
console.log(`Actieve lasten: ${(data.actief || []).length}`);
console.log(`KV-key: ${KV_KEY}`);
console.log('Sturen naar Cloudflare KV...');

try {
  // Gebruik een tijdelijk bestand om grote values veilig te kunnen doorgeven
  const tmpFile = path.join(REPO_ROOT, '_seed_tmp.json');
  fs.writeFileSync(tmpFile, value, 'utf8');

  // --remote = schrijf naar PRODUCTIE-KV (wrangler 4.x default = lokaal!)
  const cmd = `wrangler kv key put --remote --namespace-id="${KV_NAMESPACE_ID}" "${KV_KEY}" --path="${tmpFile}"`;
  execSync(cmd, { cwd: REPO_ROOT, stdio: 'inherit' });

  fs.unlinkSync(tmpFile);
  console.log('\n✓ vaste-lasten succesvol in KV gezet als cfg:vaste-lasten');
  console.log('Volgende stap: zie uitrolchecklist (stap 2 = wrangler deploy).');
} catch (e) {
  // Cleanup temp file op fout
  const tmpFile = path.join(REPO_ROOT, '_seed_tmp.json');
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  console.error('\nFOUT bij wrangler kv key put:', e.message);
  console.error('Controleer of wrangler geauthenticeerd is: wrangler whoami');
  process.exit(1);
}
