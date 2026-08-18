// tests/app-type.test.mjs
import { getAppType } from '../src/lib/app-type.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(want)}`);
    console.log(`      got     : ${JSON.stringify(got)}`);
    fail++;
  } else {
    pass++;
  }
}

// Save initial env and globals
const origEnv = process.env.NEXT_PUBLIC_APP_TYPE;

// 1. Server-side branch (window is undefined)
process.env.NEXT_PUBLIC_APP_TYPE = 'business';
eq('Server-side: returns env when window is undefined', getAppType(), 'business');

process.env.NEXT_PUBLIC_APP_TYPE = '';
eq('Server-side: defaults to personal when env is empty', getAppType(), 'personal');

delete process.env.NEXT_PUBLIC_APP_TYPE;
eq('Server-side: defaults to personal when env is undefined', getAppType(), 'personal');

// Restore env
process.env.NEXT_PUBLIC_APP_TYPE = origEnv;

// 2. Client-side branch (window is defined)
global.window = {
  location: {
    search: ''
  }
};
global.document = {
  cookie: ''
};

// Reset env
process.env.NEXT_PUBLIC_APP_TYPE = '';
eq('Client-side: defaults to personal', getAppType(), 'personal');

// Env precedence
process.env.NEXT_PUBLIC_APP_TYPE = 'business';
eq('Client-side: env resolves when present', getAppType(), 'business');

// Cookie beats env
global.document.cookie = 'qk_app_mode=personal';
eq('Client-side: cookie beats env', getAppType(), 'personal');

// Global beats cookie
global.window.__QK_APP_TYPE__ = 'business';
eq('Client-side: injected global beats cookie', getAppType(), 'business');

// URL param beats global
global.window.location.search = '?app=personal';
eq('Client-side: URL param beats injected global', getAppType(), 'personal');

// URL param persists to cookie
global.document.cookie = '';
getAppType('?app=business');
eq('Client-side: URL param persists to cookie', global.document.cookie.includes('qk_app_mode=business'), true);

// Invalid URL param is ignored
global.window.location.search = '?app=invalid';
global.window.__QK_APP_TYPE__ = 'personal';
eq('Client-side: invalid URL param is ignored', getAppType(), 'personal');

// Clean up globals
delete global.window;
delete global.document;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
