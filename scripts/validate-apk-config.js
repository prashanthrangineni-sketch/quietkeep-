#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const REQUIRED_SERVER_URL = 'https://quietkeep.com';
const configs = ['capacitor.config.json', 'capacitor.business.config.json'];
let failed = false;
for (const file of configs) {
  const p = path.resolve(__dirname, '..', file);
  if (!fs.existsSync(p)) { console.error(`MISSING: ${file}`); failed = true; continue; }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.error(`INVALID JSON: ${file}`); failed = true; continue; }
  const url = cfg?.server?.url;
  if (!url) { console.error(`FAIL ${file}: server.url MISSING`); failed = true; }
  else if (url !== REQUIRED_SERVER_URL) { console.error(`FAIL ${file}: server.url="${url}" expected="${REQUIRED_SERVER_URL}"`); failed = true; }
  else { console.log(`OK   ${file}: server.url = ${url}`); }
  if (cfg?.android?.webContentsDebuggingEnabled === true) { console.error(`FAIL ${file}: webContentsDebuggingEnabled must be false`); failed = true; }
  else { console.log(`OK   ${file}: webContentsDebuggingEnabled = false`); }
}
if (failed) { console.error('\nAPK CONFIG VALIDATION FAILED\n'); process.exit(1); }
else { console.log('\nAPK CONFIG VALIDATION PASSED\n'); }
