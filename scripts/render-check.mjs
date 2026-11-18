// scripts/render-check.mjs
// Local production render check of /, /login, /dashboard, /settings/voice

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTES = ['/', '/login', '/dashboard', '/settings/voice'];
const OUT_FILE = 'C:\\PranixEvidence\\T14\\render-check.txt';

let logLines = [];
function log(msg) {
  console.log(msg);
  logLines.push(msg);
}

log(`=== Production Render Check ===`);
log(`Date: ${new Date().toISOString()}`);
log(`Port: ${PORT}`);

// Start next server
log(`Starting production Next.js server on port ${PORT}...`);
const isWindows = process.platform === 'win32';
const nextCmd = isWindows ? 'npx.cmd' : 'npx';
const serverProc = spawn(nextCmd, ['next', 'start', '-p', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: isWindows,
  detached: false,
});

serverProc.stdout.on('data', (d) => {
  // console.log(`[next] ${d}`);
});
serverProc.stderr.on('data', (d) => {
  // console.error(`[next err] ${d}`);
});

function fetchUrl(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
          const nextUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : `${BASE}${res.headers.location}`;
          return fetchUrl(nextUrl, maxRedirects - 1).then(resolve, reject);
        }
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    }).on('error', reject);
  });
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchUrl(`${BASE}/`);
      if (res && res.status) return true;
    } catch { }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function run() {
  const ready = await waitForServer();
  if (!ready) {
    log(`ERROR: Production server failed to start within timeout.`);
    serverProc.kill();
    fs.writeFileSync(OUT_FILE, logLines.join('\n'), 'utf8');
    process.exit(1);
  }
  log(`Production server is ready and responding.`);
  log(`----------------------------------------`);

  let allPassed = true;

  for (const route of ROUTES) {
    const url = `${BASE}${route}`;
    try {
      const res = await fetchUrl(url);
      const hasAppError = res.body.includes('Application error') || res.body.includes('Internal Server Error');
      const ok = res.status < 400 && !hasAppError;
      if (!ok) allPassed = false;

      log(`Route: ${route}`);
      log(`  HTTP Status: ${res.status}`);
      log(`  Content-Type: ${res.headers['content-type']}`);
      log(`  Body Length: ${res.body.length} bytes`);
      log(`  Application Error: ${hasAppError ? 'DETECTED (FAIL)' : 'NONE (PASS)'}`);
      log(`  Result: ${ok ? 'PASS' : 'FAIL'}`);
      log(``);
    } catch (err) {
      allPassed = false;
      log(`Route: ${route}`);
      log(`  ERROR: ${err.message}`);
      log(`  Result: FAIL`);
      log(``);
    }
  }

  log(`----------------------------------------`);
  log(`Overall Render Check: ${allPassed ? 'ALL PASSED (No Application Errors)' : 'FAILED'}`);

  // Kill server
  if (isWindows) {
    spawn('taskkill', ['/pid', String(serverProc.pid), '/f', '/t'], { stdio: 'ignore' });
  } else {
    serverProc.kill('SIGKILL');
  }

  fs.writeFileSync(OUT_FILE, logLines.join('\n'), 'utf8');
  log(`Report saved to ${OUT_FILE}`);
  process.exit(allPassed ? 0 : 1);
}

run();
