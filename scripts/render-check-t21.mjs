// scripts/render-check-t21.mjs
// Local production render check of / /login /dashboard /settings/voice
// Verifies no "Application error" occurs on any of these routes in a production build.

import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTES = ['/', '/login', '/dashboard', '/settings/voice'];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchUrl(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${urlPath}`, {
      headers: { 'User-Agent': 'QuietKeepRenderCheck/1.0' },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${urlPath}`));
    });
  });
}

async function checkServerReady(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetchUrl('/');
      if (res.status) return true;
    } catch {
      await wait(1000);
    }
  }
  return false;
}

async function run() {
  console.log(`Starting Next.js production server on port ${PORT}...`);
  // Use node to invoke next's cli binary
  const nextBin = './node_modules/next/dist/bin/next';
  const server = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
    stdio: 'pipe',
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
  });

  server.stdout.on('data', (d) => process.stdout.write(`[next] ${d}`));
  server.stderr.on('data', (d) => {
    const s = String(d);
    if (!s.includes('MSG91_AUTH_KEY')) {
      process.stdout.write(`[next:err] ${s}`);
    }
  });

  let failed = false;
  const results = [];

  try {
    const ready = await checkServerReady();
    if (!ready) {
      throw new Error('Production server failed to start within 30 seconds');
    }
    console.log('Production server is ready. Testing routes...\n');

    for (const route of ROUTES) {
      const res = await fetchUrl(route);
      const isAppError = res.body.includes('Application error') || res.body.includes('Internal Server Error');
      const ok = (res.status === 200 || res.status === 307 || res.status === 308) && !isAppError;

      const logLine = `${ok ? 'PASS' : 'FAIL'}  ${route} (Status: ${res.status}, Length: ${res.body.length} bytes, Application error: ${isAppError ? 'YES' : 'NO'})`;
      console.log(logLine);
      results.push(logLine);

      if (!ok) {
        failed = true;
        console.error(`      Error response snippet: ${res.body.slice(0, 300)}`);
      }
    }
  } catch (err) {
    console.error('Render check failed with error:', err.message);
    failed = true;
  } finally {
    console.log('\nStopping production server...');
    server.kill();
    // On Windows, kill child process tree
    if (server.pid) {
      try {
        spawn('taskkill', ['/pid', String(server.pid), '/f', '/t']);
      } catch {}
    }
  }

  console.log(`\n================================================================`);
  console.log(`FINAL RESULT: ${!failed ? 'ALL PRODUCTION ROUTES RENDERED CLEANLY (NO APPLICATION ERROR)' : 'RENDER CHECK FAILED'}`);
  console.log(`================================================================`);

  process.exit(failed ? 1 : 0);
}

run();
