import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const HARNESS_PATH = path.join(ROOT_DIR, 'test/fixture/gemini-harness.html');
const DIST_PATH = path.join(ROOT_DIR, 'dist/gemini-shortcuts.user.js');

if (!fs.existsSync(DIST_PATH)) {
  console.error('dist/gemini-shortcuts.user.js not found. Run `npm run build` first.');
  process.exit(1);
}

const harnessHtml = fs.readFileSync(HARNESS_PATH, 'utf8');
const userscriptJs = fs.readFileSync(DIST_PATH, 'utf8');

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(harnessHtml);
    return;
  }
  if (urlPath === '/csp') {
    const stripped = harnessHtml
      .replace('<script src="/dist/gemini-shortcuts.user.js"></script>', '')
      .replace('<style>', '<style nonce="testnonce">')
      .replace('<script>', '<script nonce="testnonce">');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'nonce-testnonce'; style-src 'nonce-testnonce';",
    });
    res.end(stripped);
    return;
  }
  if (urlPath === '/dist/gemini-shortcuts.user.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(userscriptJs);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port: httpPort } = server.address();
const bidiPort = 9300 + Math.floor(Math.random() * 500);

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-firefox-'));
const profileDir = path.join(tmpBase, 'profile');
const homeDir = path.join(tmpBase, 'home');
const extDir = path.join(tmpBase, 'ext');
fs.mkdirSync(profileDir, { recursive: true });
fs.mkdirSync(homeDir, { recursive: true });
fs.mkdirSync(extDir, { recursive: true });

fs.writeFileSync(
  path.join(extDir, 'manifest.json'),
  JSON.stringify(
    {
      manifest_version: 2,
      name: 'GTM Firefox E2E Loader',
      version: '0.1',
      browser_specific_settings: { gecko: { id: 'gtm-e2e@example.com' } },
      permissions: ['<all_urls>'],
      content_scripts: [
        {
          matches: ['http://127.0.0.1/csp*'],
          js: ['gm-shim.js', 'gemini-shortcuts.user.js'],
          run_at: 'document_idle',
        },
      ],
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(extDir, 'gm-shim.js'),
  `window.GM_addStyle = function(css) {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
  };`,
);
fs.writeFileSync(path.join(extDir, 'gemini-shortcuts.user.js'), userscriptJs);

const ff = spawn(
  'firefox',
  [
    '--headless',
    '--no-remote',
    '--profile',
    profileDir,
    '--remote-debugging-port',
    String(bidiPort),
    'about:blank',
  ],
  { env: { ...process.env, HOME: homeDir }, stdio: ['ignore', 'pipe', 'pipe'] },
);

let stderrLog = '';
ff.stderr.on('data', (c) => { stderrLog += c.toString(); });
ff.stdout.on('data', (c) => { stderrLog += c.toString(); });

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Firefox BiDi timeout:\n${stderrLog}`)), 15000);
  const poll = () => {
    if (stderrLog.includes(`ws://127.0.0.1:${bidiPort}`)) {
      clearTimeout(timer);
      resolve();
    } else {
      setTimeout(poll, 100);
    }
  };
  poll();
});

const ws = new WebSocket(`ws://127.0.0.1:${bidiPort}/session`);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.type === 'error') reject(new Error(`${msg.error}: ${msg.message}`));
    else resolve(msg.result);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function verifyScenario(context, url, label) {
  await send('browsingContext.navigate', { context, url, wait: 'complete' });
  await new Promise((r) => setTimeout(r, 350));

  const evalJson = async (expr) => {
    const r = await send('script.evaluate', {
      expression: `JSON.stringify(${expr})`,
      target: { context },
      awaitPromise: true,
    });
    if (r.type === 'exception') {
      throw new Error(`Exception in ${label}: ${JSON.stringify(r.exceptionDetails)}`);
    }
    return JSON.parse(r.result.value);
  };

  const getState = () =>
    evalJson(`(() => {
      const btn = document.querySelector('button[data-gtm-feature="skip-to-previous-prompt"]');
      const scroller = document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
      return {
        activeFeature: document.activeElement?.getAttribute?.('data-gtm-feature') || null,
        activeAria: document.activeElement?.getAttribute?.('aria-label') || null,
        scrollTop: Math.round(scroller.scrollTop),
        maxScroll: Math.round(scroller.scrollHeight - scroller.clientHeight),
        btnExists: Boolean(btn),
        btnFocusedClass: Boolean(btn?.classList.contains('gtm-skip-prev-prompt--focused')),
        btnOpacity: btn ? getComputedStyle(btn).opacity : null,
        btnPointerEvents: btn ? getComputedStyle(btn).pointerEvents : null,
      };
    })()`);

  const press = async (key, shift = false, waitMs = 200) => {
    const actions = [];
    if (shift) actions.push({ type: 'keyDown', value: '\uE008' });
    actions.push({ type: 'keyDown', value: key });
    actions.push({ type: 'keyUp', value: key });
    if (shift) actions.push({ type: 'keyUp', value: '\uE008' });
    await send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions }] });
    await new Promise((r) => setTimeout(r, waitMs));
  };

  const initial = await getState();
  assert.equal(initial.btnExists, true, `${label}: button must be mounted`);
  assert.equal(initial.btnOpacity, '0', `${label}: button must start hidden`);
  assert.ok(initial.maxScroll > 200, `${label}: scroller must overflow`);

  // Click ql-editor
  const rect = await evalJson(`document.querySelector('.ql-editor').getBoundingClientRect()`);
  await send('input.performActions', {
    context,
    actions: [
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          { type: 'pointerMove', x: Math.round(rect.left + 20), y: Math.round(rect.top + 10) },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  });
  await new Promise((r) => setTimeout(r, 150));

  // Shift+Tab -> focuses and reveals skip button
  await press('\uE004', true, 250);
  const afterShiftTab = await getState();
  assert.equal(afterShiftTab.activeFeature, 'skip-to-previous-prompt', `${label}: Shift+Tab focuses skip button`);
  assert.equal(afterShiftTab.btnFocusedClass, true, `${label}: focused class applied`);
  assert.equal(afterShiftTab.btnOpacity, '1', `${label}: button visible when focused`);
  assert.equal(afterShiftTab.btnPointerEvents, 'auto', `${label}: pointer-events enabled when focused`);

  // ArrowUp / ArrowDown
  await press('\uE013');
  const afterUp = await getState();
  assert.ok(afterUp.scrollTop < afterShiftTab.scrollTop, `${label}: ArrowUp scrolls up`);

  await press('\uE015');
  const afterDown = await getState();
  assert.ok(afterDown.scrollTop > afterUp.scrollTop, `${label}: ArrowDown scrolls down`);

  // PageUp / PageDown
  await press('\uE00E', false, 450);
  const afterPageUp = await getState();
  assert.ok(afterPageUp.scrollTop < afterDown.scrollTop - 150, `${label}: PageUp scrolls up a page`);

  await press('\uE00F', false, 450);
  const afterPageDown = await getState();
  assert.ok(afterPageDown.scrollTop > afterPageUp.scrollTop + 150, `${label}: PageDown scrolls down a page`);

  // Return -> skips to previous prompts (Prompt 2, then Prompt 1)
  await press('\uE006', false, 500);
  const afterEnter1 = await getState();
  assert.ok(afterEnter1.scrollTop < afterPageDown.scrollTop - 200, `${label}: 1st Enter skips to Prompt 2`);

  await press('\uE006', false, 500);
  const afterEnter2 = await getState();
  assert.ok(afterEnter2.scrollTop < afterEnter1.scrollTop - 100, `${label}: 2nd Enter skips to Prompt 1`);

  // Tab -> returns to ql-editor and hides pill
  await press('\uE004', false, 250);
  const afterTab = await getState();
  assert.equal(afterTab.activeAria, 'Enter a prompt for Gemini', `${label}: Tab returns focus to input`);
  assert.equal(afterTab.btnOpacity, '0', `${label}: pill hides after Tab`);

  // Shift+Tab then Escape -> returns to ql-editor
  await press('\uE004', true, 200);
  await press('\uE00C', false, 250);
  const afterEsc = await getState();
  assert.equal(afterEsc.activeAria, 'Enter a prompt for Gemini', `${label}: Escape returns focus to input`);
  assert.equal(afterEsc.btnOpacity, '0', `${label}: pill hides after Escape`);

  // Shift+Tab twice -> Upload & tools (no focus trap)
  await press('\uE004', true, 200);
  await press('\uE004', true, 250);
  const after2ShiftTab = await getState();
  assert.equal(after2ShiftTab.activeAria, 'Upload & tools', `${label}: 2nd Shift+Tab moves to Upload & tools`);
  assert.equal(after2ShiftTab.btnOpacity, '0', `${label}: pill hides after 2nd Shift+Tab`);

  console.log(`PASS: ${label}`);
}

try {
  await send('session.new', { capabilities: {} });
  const tree = await send('browsingContext.getTree');
  const context = tree.contexts[0].context;

  await verifyScenario(context, `http://127.0.0.1:${httpPort}/`, 'Firefox Direct Page');

  await send('webExtension.install', { extensionData: { type: 'path', path: extDir } });
  await verifyScenario(
    context,
    `http://127.0.0.1:${httpPort}/csp`,
    'Firefox WebExtension Content Script + Strict CSP',
  );
  console.log('All Firefox E2E tests passed.');
} finally {
  ws.close();
  ff.kill();
  server.close();
  fs.rmSync(tmpBase, { recursive: true, force: true });
}
