import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { createDevLoaderScript } from './dev-server.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const HARNESS_PATH = path.join(ROOT_DIR, 'test/fixture/gemini-harness.html');
const DIST_PATH = path.join(ROOT_DIR, 'dist/gemini-shortcuts.user.js');
const DEFAULT_VIMIUM_XPI_PATH = path.join(ROOT_DIR, 'test/fixture/extensions/vimium_ff-2.4.2.xpi');
const DEFAULT_VIMIUM_XPI_SHA256 =
  '131e2a67580e7ae9125ab19781159e61409fac47b441fc2782aab76396ead196';

function resolveVimiumExtensionData() {
  const overridePath = process.env.VIMIUM_EXTENSION_PATH;
  if (overridePath) {
    const resolved = path.resolve(overridePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`VIMIUM_EXTENSION_PATH does not exist: ${resolved}`);
    }
    const stat = fs.statSync(resolved);
    return stat.isDirectory()
      ? { type: 'path', path: resolved }
      : { type: 'archivePath', path: resolved };
  }

  if (!fs.existsSync(DEFAULT_VIMIUM_XPI_PATH)) {
    throw new Error(`Bundled Vimium extension fixture not found: ${DEFAULT_VIMIUM_XPI_PATH}`);
  }
  const actualHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(DEFAULT_VIMIUM_XPI_PATH))
    .digest('hex');
  assert.equal(
    actualHash,
    DEFAULT_VIMIUM_XPI_SHA256,
    `Bundled Vimium XPI SHA-256 mismatch for ${DEFAULT_VIMIUM_XPI_PATH}`,
  );
  return { type: 'archivePath', path: DEFAULT_VIMIUM_XPI_PATH };
}

if (!fs.existsSync(DIST_PATH)) {
  console.error('dist/gemini-shortcuts.user.js not found. Run `npm run build` first.');
  process.exit(1);
}

const vimiumExtensionData = resolveVimiumExtensionData();
const harnessHtml = fs.readFileSync(HARNESS_PATH, 'utf8');
const userscriptJs = fs.readFileSync(DIST_PATH, 'utf8');

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(harnessHtml);
    return;
  }
  if (urlPath === '/no-userscript') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(harnessHtml.replace('<script src="/dist/gemini-shortcuts.user.js"></script>', ''));
    return;
  }
  if (urlPath === '/zero-state') {
    const zeroStateHtml = harnessHtml
      .replace(
        '<body class="theme-host dark-theme">',
        `<style>
          .center-input-layout input-container {
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            position: relative;
            width: 100%;
            min-height: 61px;
            padding: 0 16px;
          }
          .center-input-layout .input-area-container {
            display: flex;
            flex-direction: column;
            align-self: center;
            width: 100%;
            max-width: 660px;
            position: relative;
          }
          .center-input-layout .input-area-container.is-zero-state:not(.is-mobile) {
            position: absolute;
            width: auto;
            left: 28px;
            right: 28px;
            margin-inline: auto;
            bottom: 50vh;
            pointer-events: none;
          }
          .center-input-layout .input-area-container.is-zero-state > input-area-v2 {
            pointer-events: auto;
          }
          .center-input-layout .text-input-field {
            grid-template-columns: minmax(0, auto) 1fr auto;
          }
        </style>
        <body class="theme-host dark-theme center-input-layout">`,
      )
      .replace(
        '<div class="input-area-container">',
        '<div class="input-area-container is-zero-state" style="--initial-input-half-height: 32px; position: absolute; bottom: 50vh; transform: translateY(calc(100% - 32px));">',
      );
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(zeroStateHtml);
    return;
  }
  if (urlPath === '/csp' || urlPath === '/csp-dev') {
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
          matches: ['http://127.0.0.1/csp'],
          js: ['gm-shim.js', 'gemini-shortcuts.user.js'],
          run_at: 'document_idle',
        },
        {
          matches: ['http://127.0.0.1/csp-dev*'],
          js: ['gm-dev-shim.js', 'dev-loader.user.js'],
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
fs.writeFileSync(
  path.join(extDir, 'gm-dev-shim.js'),
  `window.Function = function() {
    throw new EvalError('call to Function() blocked by CSP');
  };
  window.GM_addStyle = function(css) {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
  };
  window.GM_addElement = function(tagOrParent, tagOrAttrs, maybeAttrs) {
    const isParent = typeof tagOrParent !== 'string';
    const parent = isParent ? tagOrParent : (document.head || document.documentElement);
    const tag = isParent ? tagOrAttrs : tagOrParent;
    const attrs = (isParent ? maybeAttrs : tagOrAttrs) || {};
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'textContent') el.textContent = v;
      else el.setAttribute(k, v);
    }
    parent.appendChild(el);
    return el;
  };
  window.GM_xmlhttpRequest = function(opts) {
    fetch(opts.url)
      .then((r) => r.text().then((text) => ({ status: r.status, responseText: text, responseHeaders: '' })))
      .then((res) => opts.onload && opts.onload(res))
      .catch((err) => opts.onerror && opts.onerror(err));
  };`,
);
fs.writeFileSync(path.join(extDir, 'gemini-shortcuts.user.js'), userscriptJs);
fs.writeFileSync(path.join(extDir, 'dev-loader.user.js'), createDevLoaderScript({ port: httpPort }));

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

async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 40, message = 'Condition timed out' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(message);
}

function createContextHelpers(context, label) {
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

  const press = async (key, shift = false, waitMs = 200) => {
    const actions = [];
    if (shift) actions.push({ type: 'keyDown', value: '\uE008' });
    actions.push({ type: 'keyDown', value: key });
    actions.push({ type: 'keyUp', value: key });
    if (shift) actions.push({ type: 'keyUp', value: '\uE008' });
    await send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions }] });
    await new Promise((r) => setTimeout(r, waitMs));
  };

  const clickViaVimium = async (selector, { openKey = 'f', expectSingleHint = false } = {}) => {
    // Wait for any previous Vimium flash overlay (.vimium-flash, 400ms) to clear
    // so it cannot occlude elementFromPoint during hint generation.
    await waitFor(
      () => evalJson(`!document.querySelector('.vimium-flash')`),
      {
        timeoutMs: 1500,
        message: `${label}: Vimium flash overlay did not clear before pressing '${openKey}'`,
      },
    );

    // Open Vimium link hints
    await press(openKey, false, 60);
    await waitFor(
      () =>
        evalJson(
          `document.querySelectorAll('#vimium-hint-marker-container .vimiumHintMarker').length > 0`,
        ),
      {
        timeoutMs: 2500,
        message: `${label}: Vimium hint markers did not appear after pressing '${openKey}'`,
      },
    );

    const hintLookup = await evalJson(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) return { error: 'target not found' };
      const clientRects = Array.from(target.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      const tRect = clientRects[0] || target.getBoundingClientRect();
      const fullRect = target.getBoundingClientRect();
      const markers = Array.from(
        document.querySelectorAll('#vimium-hint-marker-container .vimiumHintMarker'),
      ).map((m) => {
        const r = m.getBoundingClientRect();
        return { text: m.textContent.trim(), left: r.left, top: r.top };
      });
      const near = markers
        .map((m) => ({
          ...m,
          dist: Math.hypot(m.left - tRect.left, m.top - tRect.top),
          insideTarget:
            m.left >= fullRect.left - 8 &&
            m.left <= fullRect.right + 4 &&
            m.top >= fullRect.top - 8 &&
            m.top <= fullRect.bottom + 4,
        }))
        .filter((m) => m.dist <= 20)
        .sort((a, b) => a.dist - b.dist);
      return {
        targetRect: {
          left: Math.round(tRect.left),
          top: Math.round(tRect.top),
          width: Math.round(fullRect.width),
          height: Math.round(fullRect.height),
        },
        markerCount: markers.length,
        near,
        insideCount: markers.filter(
          (m) =>
            m.left >= fullRect.left - 6 &&
            m.left <= fullRect.right + 2 &&
            m.top >= fullRect.top - 6 &&
            m.top <= fullRect.bottom + 2,
        ).length,
      };
    })()`);

    if (hintLookup.error || hintLookup.near.length === 0) {
      await press('\uE00C', false, 100);
      throw new Error(
        `${label}: Vimium did not render a hint for ${selector}: ${JSON.stringify(hintLookup)}`,
      );
    }

    if (expectSingleHint) {
      assert.equal(
        hintLookup.insideCount,
        1,
        `${label}: expected exactly 1 Vimium hint for ${selector}, got ${JSON.stringify(hintLookup)}`,
      );
    }

    const hintKeys = hintLookup.near[0].text.toLowerCase();
    for (const ch of hintKeys) {
      await press(ch, false, 50);
    }

    await waitFor(
      () => evalJson(`!document.getElementById('vimium-hint-marker-container')`),
      {
        timeoutMs: 2000,
        message: `${label}: Vimium hint mode did not exit after typing '${hintKeys}' for ${selector}`,
      },
    );
    await new Promise((r) => setTimeout(r, 150));
    return hintKeys;
  };

  return { evalJson, press, clickViaVimium };
}

async function verifyVimiumWithoutUserscript(context, url, label) {
  await send('browsingContext.navigate', { context, url, wait: 'complete' });
  await new Promise((r) => setTimeout(r, 500));

  const { evalJson, clickViaVimium } = createContextHelpers(context, label);
  await evalJson(`(() => { document.activeElement?.blur?.(); return true; })()`);

  // Without the userscript, real Vimium clicking a citation chip does NOT open its popover
  await clickViaVimium('#chip-zed');
  const afterChip = await evalJson(`(() => ({
    zedExpanded: document.getElementById('chip-zed')?.getAttribute('aria-expanded') || null,
    dialogExists: Boolean(document.querySelector('.cdk-overlay-pane [role="dialog"].hover-card-container')),
  }))()`);
  assert.equal(afterChip.zedExpanded, 'false', `${label}: without userscript, Vimium click must not expand chip`);
  assert.equal(afterChip.dialogExists, false, `${label}: without userscript, Vimium click must not open popover`);

  // Even if #chip-zed is hovered open afterward, Vimium still remembers #chip-zed
  // as its lastHoveredElement from the click above. Clicking the source link via
  // Vimium dispatches a synthetic mouseout on #chip-zed first, tearing down the
  // popover before click fires!
  await evalJson(`(() => {
    window.__lastSourceCardHref = null;
    document.getElementById('chip-zed').dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    return Boolean(document.querySelector('.cdk-overlay-pane inline-source-card'));
  })()`);
  await new Promise((r) => setTimeout(r, 150));
  await clickViaVimium('.cdk-overlay-pane inline-source-card a[href]');
  const afterLayer2WithoutFix = await evalJson(`(() => ({
    href: window.__lastSourceCardHref,
    dialogExists: Boolean(document.querySelector('.cdk-overlay-pane [role="dialog"].hover-card-container')),
  }))()`);
  assert.equal(
    afterLayer2WithoutFix.dialogExists,
    false,
    `${label}: without userscript, Vimium lastHoveredElement mouseout closes the popover`,
  );
  assert.equal(
    afterLayer2WithoutFix.href,
    null,
    `${label}: without userscript, Vimium popover link click fails because popover was torn down`,
  );

  console.log(`PASS: ${label}`);
}

async function verifyScenario(context, url, label) {
  await send('browsingContext.navigate', { context, url, wait: 'complete' });
  await new Promise((r) => setTimeout(r, 500));

  const { evalJson, press, clickViaVimium } = createContextHelpers(context, label);

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

  const pressCtrlAlt = async (key, waitMs = 500) => {
    await send('input.performActions', {
      context,
      actions: [
        {
          type: 'key',
          id: 'kbd',
          actions: [
            { type: 'keyDown', value: '\uE009' },
            { type: 'keyDown', value: '\uE00A' },
            { type: 'keyDown', value: key },
            { type: 'keyUp', value: key },
            { type: 'keyUp', value: '\uE00A' },
            { type: 'keyUp', value: '\uE009' },
          ],
        },
      ],
    });
    await new Promise((r) => setTimeout(r, waitMs));
  };
  const initial = await getState();
  assert.equal(initial.btnExists, true, `${label}: button must be mounted`);
  assert.equal(initial.btnOpacity, '0', `${label}: button must start hidden`);
  assert.ok(initial.maxScroll > 200, `${label}: scroller must overflow`);

  // Verify anchor becomes positioned (relative) when unpositioned in CSS, keeping button aligned above it
  const activeLayout = await evalJson(`(() => {
    const anchor = document.querySelector('div.input-area-container');
    const btn = document.querySelector('button[data-gtm-feature="skip-to-previous-prompt"]');
    const aRect = anchor.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    return {
      anchorPosition: getComputedStyle(anchor).position,
      rightDelta: Math.abs(bRect.right - aRect.right),
    };
  })()`);
  assert.equal(activeLayout.anchorPosition, 'relative', `${label}: unpositioned anchor falls back to position: relative`);
  assert.ok(activeLayout.rightDelta <= 2, `${label}: skip button aligns with anchor right edge (delta=${activeLayout.rightDelta})`);

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

  // PageUp while prompt input is focused -> scrolls smoothly without leaving input
  const beforeInputPageUp = await getState();
  assert.equal(beforeInputPageUp.activeAria, 'Enter a prompt for Gemini', `${label}: input focused before PageUp`);
  await press('\uE00E', false, 90);
  const midInputPageUp = await getState();
  await new Promise((r) => setTimeout(r, 500));
  const afterInputPageUp = await getState();
  assert.equal(afterInputPageUp.activeAria, 'Enter a prompt for Gemini', `${label}: input stays focused on PageUp`);
  assert.ok(
    afterInputPageUp.scrollTop < beforeInputPageUp.scrollTop - 150,
    `${label}: PageUp while input focused scrolls up a page (${beforeInputPageUp.scrollTop} -> ${afterInputPageUp.scrollTop})`,
  );
  assert.ok(
    midInputPageUp.scrollTop < beforeInputPageUp.scrollTop &&
      midInputPageUp.scrollTop > afterInputPageUp.scrollTop,
    `${label}: PageUp while input focused animates smoothly (start=${beforeInputPageUp.scrollTop}, mid=${midInputPageUp.scrollTop}, end=${afterInputPageUp.scrollTop})`,
  );

  // PageDown while prompt input is focused -> smoothly scrolls back down without leaving input
  await press('\uE00F', false, 550);
  const afterInputPageDown = await getState();
  assert.equal(afterInputPageDown.activeAria, 'Enter a prompt for Gemini', `${label}: input stays focused on PageDown`);
  assert.ok(
    afterInputPageDown.scrollTop > afterInputPageUp.scrollTop + 150,
    `${label}: PageDown while input focused scrolls down a page (${afterInputPageUp.scrollTop} -> ${afterInputPageDown.scrollTop})`,
  );

  // Rapid double-tap PageUp while input is focused accumulates smoothly beyond a single page
  const singlePageDelta = beforeInputPageUp.scrollTop - afterInputPageUp.scrollTop;
  await press('\uE00E', false, 60);
  await press('\uE00E', false, 650);
  const afterDoublePageUp = await getState();
  assert.equal(afterDoublePageUp.activeAria, 'Enter a prompt for Gemini', `${label}: input stays focused after rapid PageUp`);
  assert.ok(
    afterInputPageDown.scrollTop - afterDoublePageUp.scrollTop > singlePageDelta * 1.25,
    `${label}: rapid PageUp taps accumulate smoothly (moved ${afterInputPageDown.scrollTop - afterDoublePageUp.scrollTop}px vs single ${singlePageDelta}px)`,
  );

  // Shift+PageDown while input is focused is ignored (preserves text selection)
  await press('\uE00F', true, 200);
  const afterShiftPageDown = await getState();
  assert.equal(
    afterShiftPageDown.scrollTop,
    afterDoublePageUp.scrollTop,
    `${label}: Shift+PageDown does not hijack chat scroll`,
  );

  // Hold PageDown back to bottom smoothly while input is focused
  await send('input.performActions', {
    context,
    actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '\uE00F' }] }],
  });
  await new Promise((r) => setTimeout(r, 700));
  await send('input.performActions', {
    context,
    actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyUp', value: '\uE00F' }] }],
  });
  await new Promise((r) => setTimeout(r, 450));
  const afterHoldInputPageDown = await getState();
  assert.equal(afterHoldInputPageDown.activeAria, 'Enter a prompt for Gemini', `${label}: input stays focused after held PageDown`);
  assert.ok(
    afterHoldInputPageDown.scrollTop > afterDoublePageUp.scrollTop + singlePageDelta * 1.2,
    `${label}: holding PageDown while input focused smoothly scrolls back down (${afterDoublePageUp.scrollTop} -> ${afterHoldInputPageDown.scrollTop})`,
  );

  // Ctrl+Alt+[ and Ctrl+Alt+] navigate between prompts while keeping focus in prompt input
  await evalJson(`(() => {
    const scroller = document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
    scroller.scrollTop = scroller.scrollHeight;
    return true;
  })()`);
  const beforeInputPromptNav = await getState();
  await pressCtrlAlt('[', 550);
  const afterCtrlAltPrev1 = await getState();
  assert.equal(afterCtrlAltPrev1.activeAria, 'Enter a prompt for Gemini', `${label}: input stays focused on Ctrl+Alt+[ (1)`);
  assert.ok(
    afterCtrlAltPrev1.scrollTop < beforeInputPromptNav.scrollTop - 200,
    `${label}: 1st Ctrl+Alt+[ skips to Prompt 2 (${beforeInputPromptNav.scrollTop} -> ${afterCtrlAltPrev1.scrollTop})`,
  );

  await pressCtrlAlt('[', 550);
  const afterCtrlAltPrev2 = await getState();
  assert.equal(afterCtrlAltPrev2.activeAria, 'Enter a prompt for Gemini', `${label}: input stays focused on Ctrl+Alt+[ (2)`);
  assert.ok(
    afterCtrlAltPrev2.scrollTop < afterCtrlAltPrev1.scrollTop - 100,
    `${label}: 2nd Ctrl+Alt+[ skips to Prompt 1 (${afterCtrlAltPrev1.scrollTop} -> ${afterCtrlAltPrev2.scrollTop})`,
  );

  await pressCtrlAlt(']', 550);
  const afterCtrlAltNext1 = await getState();
  assert.equal(afterCtrlAltNext1.activeAria, 'Enter a prompt for Gemini', `${label}: input stays focused on Ctrl+Alt+] (1)`);
  assert.ok(
    Math.abs(afterCtrlAltNext1.scrollTop - afterCtrlAltPrev1.scrollTop) <= 12,
    `${label}: Ctrl+Alt+] scrolls forward to Prompt 2 (expected ~${afterCtrlAltPrev1.scrollTop}, got ${afterCtrlAltNext1.scrollTop})`,
  );

  await pressCtrlAlt(']', 300);
  const afterCtrlAltNextEnd = await getState();
  assert.ok(
    Math.abs(afterCtrlAltNextEnd.scrollTop - afterCtrlAltNext1.scrollTop) <= 4,
    `${label}: Ctrl+Alt+] at last prompt stays at last prompt (${afterCtrlAltNext1.scrollTop} -> ${afterCtrlAltNextEnd.scrollTop})`,
  );

  // Ctrl+Alt+[ and Ctrl+Alt+] also work when focus is outside the prompt input (e.g. body)
  await evalJson(`(() => {
    const scroller = document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
    scroller.scrollTop = scroller.scrollHeight;
    document.activeElement?.blur?.();
    return true;
  })()`);
  const beforeBodyPromptNav = await getState();
  assert.notEqual(beforeBodyPromptNav.activeAria, 'Enter a prompt for Gemini', `${label}: input blurred before body Ctrl+Alt+[`);
  await pressCtrlAlt('[', 550);
  const afterBodyCtrlAltPrev = await getState();
  assert.notEqual(afterBodyCtrlAltPrev.activeAria, 'Enter a prompt for Gemini', `${label}: Ctrl+Alt+[ does not steal focus back to input`);
  assert.ok(
    afterBodyCtrlAltPrev.scrollTop < beforeBodyPromptNav.scrollTop - 200,
    `${label}: Ctrl+Alt+[ works when body is focused (${beforeBodyPromptNav.scrollTop} -> ${afterBodyCtrlAltPrev.scrollTop})`,
  );
  await pressCtrlAlt('[', 550);
  const afterBodyCtrlAltPrev2 = await getState();
  assert.ok(
    afterBodyCtrlAltPrev2.scrollTop < afterBodyCtrlAltPrev.scrollTop - 100,
    `${label}: 2nd Ctrl+Alt+[ works when body is focused (${afterBodyCtrlAltPrev.scrollTop} -> ${afterBodyCtrlAltPrev2.scrollTop})`,
  );
  await pressCtrlAlt(']', 550);
  const afterBodyCtrlAltNext = await getState();
  assert.ok(
    Math.abs(afterBodyCtrlAltNext.scrollTop - afterBodyCtrlAltPrev.scrollTop) <= 12,
    `${label}: Ctrl+Alt+] works when body is focused (expected ~${afterBodyCtrlAltPrev.scrollTop}, got ${afterBodyCtrlAltNext.scrollTop})`,
  );

  // Restore focus to input and scroll to bottom for Skip button tests
  await evalJson(`(() => {
    const scroller = document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
    scroller.scrollTop = scroller.scrollHeight;
    document.querySelector('.ql-editor[contenteditable="true"]')?.focus();
    return true;
  })()`);

  // Shift+Tab -> focuses and reveals skip button
  await press('\uE004', true, 250);
  const afterShiftTab = await getState();
  assert.equal(afterShiftTab.activeFeature, 'skip-to-previous-prompt', `${label}: Shift+Tab focuses skip button`);
  assert.equal(afterShiftTab.btnFocusedClass, true, `${label}: focused class applied`);
  assert.equal(afterShiftTab.btnOpacity, '1', `${label}: button visible when focused`);
  assert.equal(afterShiftTab.btnPointerEvents, 'auto', `${label}: pointer-events enabled when focused`);

  // ArrowUp / ArrowDown taps
  await press('\uE013', false, 300);
  const afterUp = await getState();
  assert.ok(afterUp.scrollTop < afterShiftTab.scrollTop - 30, `${label}: ArrowUp tap scrolls up smoothly`);

  await press('\uE015', false, 300);
  const afterDown = await getState();
  assert.ok(afterDown.scrollTop > afterUp.scrollTop + 30, `${label}: ArrowDown tap scrolls down smoothly`);

  // Holding ArrowUp scrolls continuously beyond a single step and coasts to rest
  await send('input.performActions', {
    context,
    actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '\uE013' }] }],
  });
  await new Promise((r) => setTimeout(r, 450));
  await send('input.performActions', {
    context,
    actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyUp', value: '\uE013' }] }],
  });
  await new Promise((r) => setTimeout(r, 300));
  const afterHoldUp = await getState();
  assert.ok(
    afterHoldUp.scrollTop < afterDown.scrollTop - 180,
    `${label}: holding ArrowUp scrolls continuously (moved ${afterDown.scrollTop - afterHoldUp.scrollTop}px)`,
  );

  // Hold ArrowDown back down to restore room for PageUp check
  await send('input.performActions', {
    context,
    actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '\uE015' }] }],
  });
  await new Promise((r) => setTimeout(r, 450));
  await send('input.performActions', {
    context,
    actions: [{ type: 'key', id: 'kbd', actions: [{ type: 'keyUp', value: '\uE015' }] }],
  });
  await new Promise((r) => setTimeout(r, 300));
  const afterHoldDown = await getState();
  assert.ok(
    afterHoldDown.scrollTop > afterHoldUp.scrollTop + 180,
    `${label}: holding ArrowDown scrolls continuously (moved ${afterHoldDown.scrollTop - afterHoldUp.scrollTop}px)`,
  );

  // PageUp / PageDown
  await press('\uE00E', false, 450);
  const afterPageUp = await getState();
  assert.ok(afterPageUp.scrollTop < afterHoldDown.scrollTop - 150, `${label}: PageUp scrolls up a page`);

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

  // Shift+ArrowDown / Shift+ArrowUp while Skip button is focused -> jump to next / previous prompt
  await press('\uE015', true, 550);
  const afterShiftDown1 = await getState();
  assert.equal(afterShiftDown1.activeFeature, 'skip-to-previous-prompt', `${label}: Shift+ArrowDown keeps focus on skip button`);
  assert.ok(
    Math.abs(afterShiftDown1.scrollTop - afterEnter1.scrollTop) <= 12,
    `${label}: Shift+ArrowDown jumps to Prompt 2 (expected ~${afterEnter1.scrollTop}, got ${afterShiftDown1.scrollTop})`,
  );

  await press('\uE015', true, 300);
  const afterShiftDownEnd = await getState();
  assert.ok(
    Math.abs(afterShiftDownEnd.scrollTop - afterShiftDown1.scrollTop) <= 4,
    `${label}: Shift+ArrowDown at last prompt stays at last prompt (${afterShiftDown1.scrollTop} -> ${afterShiftDownEnd.scrollTop})`,
  );

  await press('\uE013', true, 550);
  const afterShiftUp1 = await getState();
  assert.equal(afterShiftUp1.activeFeature, 'skip-to-previous-prompt', `${label}: Shift+ArrowUp keeps focus on skip button`);
  assert.ok(
    Math.abs(afterShiftUp1.scrollTop - afterEnter2.scrollTop) <= 12,
    `${label}: Shift+ArrowUp jumps back to Prompt 1 (expected ~${afterEnter2.scrollTop}, got ${afterShiftUp1.scrollTop})`,
  );

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

  // --- Ctrl+K Search Chats Dialog E2E ---
  const pressCtrl = async (key, waitMs = 200) => {
    await send('input.performActions', {
      context,
      actions: [
        {
          type: 'key',
          id: 'kbd',
          actions: [
            { type: 'keyDown', value: '\uE009' },
            { type: 'keyDown', value: key },
            { type: 'keyUp', value: key },
            { type: 'keyUp', value: '\uE009' },
          ],
        },
      ],
    });
    await new Promise((r) => setTimeout(r, waitMs));
  };

  const typeText = async (text, waitMs = 150) => {
    const actions = [];
    for (const ch of text) {
      actions.push({ type: 'keyDown', value: ch });
      actions.push({ type: 'keyUp', value: ch });
    }
    await send('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions }] });
    await new Promise((r) => setTimeout(r, waitMs));
  };

  const getSearchState = () =>
    evalJson(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Search chats"]');
      const input = dialog ? dialog.querySelector('input[type="search"]') : null;
      const viewport = dialog ? dialog.querySelector('[data-id$="-viewport"]') : null;
      const links = dialog ? Array.from(dialog.querySelectorAll('ul li a[href]')) : [];
      const activeIdx = links.findIndex((a) => a.getAttribute('data-gtm-search-active') === 'true');
      const activeEl = activeIdx >= 0 ? links[activeIdx] : null;
      const vRect = viewport ? viewport.getBoundingClientRect() : null;
      const aRect = activeEl ? activeEl.getBoundingClientRect() : null;
      const scroller = document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
      return {
        dialogOpen: Boolean(dialog),
        inputFocused: Boolean(input && document.activeElement === input),
        inputValue: input ? input.value : null,
        selectionStart: input ? input.selectionStart : null,
        ariaActiveDescendant: input ? input.getAttribute('aria-activedescendant') : null,
        optionCount: links.length,
        activeIdx,
        activeId: activeEl ? activeEl.id : null,
        activeHref: activeEl ? activeEl.getAttribute('href') : null,
        activeBg: activeEl ? getComputedStyle(activeEl).backgroundColor : null,
        inactiveBg: links.find((_, i) => i !== activeIdx)
          ? getComputedStyle(links.find((_, i) => i !== activeIdx)).backgroundColor
          : null,
        viewportScrollTop: viewport ? Math.round(viewport.scrollTop) : 0,
        activeInViewport: Boolean(vRect && aRect && aRect.top >= vRect.top - 2 && aRect.bottom <= vRect.bottom + 2),
        chatScrollTop: Math.round(scroller.scrollTop),
        lastOpenedChatHref: window.__lastOpenedChatHref || null,
      };
    })()`);

  // Open Ctrl+K dialog
  await pressCtrl('k', 200);
  const searchOpen = await getSearchState();
  assert.equal(searchOpen.dialogOpen, true, `${label}: Ctrl+K opens search dialog`);
  assert.equal(searchOpen.inputFocused, true, `${label}: search input is focused on open`);
  assert.equal(searchOpen.activeIdx, 0, `${label}: first option auto-highlighted on open`);
  assert.equal(searchOpen.ariaActiveDescendant, searchOpen.activeId, `${label}: aria-activedescendant synced`);
  assert.notEqual(searchOpen.activeBg, searchOpen.inactiveBg, `${label}: active option has distinct highlight style`);

  // ArrowDown x8 navigates down, scrolls viewport, keeps focus in search input
  for (let i = 0; i < 8; i += 1) {
    await press('\uE015', false, 60);
  }
  const afterSearchDown = await getSearchState();
  assert.equal(afterSearchDown.activeIdx, 8, `${label}: ArrowDown x8 selects index 8`);
  assert.equal(afterSearchDown.inputFocused, true, `${label}: search input keeps focus after ArrowDown`);
  assert.ok(afterSearchDown.viewportScrollTop > 0, `${label}: viewport scrolled to show index 8`);
  assert.equal(afterSearchDown.activeInViewport, true, `${label}: active option remains visible in viewport`);

  // PageUp inside dialog moves dialog selection without scrolling background chat
  const chatScrollBeforeDialogPgUp = afterSearchDown.chatScrollTop;
  await press('\uE00E', false, 100);
  const afterDialogPgUp = await getSearchState();
  assert.ok(afterDialogPgUp.activeIdx < 8, `${label}: PageUp moves dialog selection up`);
  assert.equal(afterDialogPgUp.inputFocused, true, `${label}: search input keeps focus after PageUp`);
  assert.equal(afterDialogPgUp.chatScrollTop, chatScrollBeforeDialogPgUp, `${label}: PageUp in dialog does not scroll background chat`);

  // Type directly without re-focusing -> filters results and auto-selects index 0
  await typeText('orbit', 150);
  const afterTyping = await getSearchState();
  assert.equal(afterTyping.inputFocused, true, `${label}: search input stays focused while typing`);
  assert.equal(afterTyping.inputValue, 'orbit', `${label}: typing updates search input value`);
  assert.equal(afterTyping.optionCount, 4, `${label}: filtered results count matches`);
  assert.equal(afterTyping.activeIdx, 0, `${label}: typing resets selection to top match`);

  // Move caret left twice, press ArrowDown to select 2nd match, verify caret did NOT jump and editing continues seamlessly
  await press('\uE012', false, 50); // ArrowLeft
  await press('\uE012', false, 50); // ArrowLeft -> caret at index 3 ("orb|it")
  await press('\uE015', false, 80); // ArrowDown -> selects index 1
  const afterMidEditArrow = await getSearchState();
  assert.equal(afterMidEditArrow.activeIdx, 1, `${label}: ArrowDown selects 2nd filtered match`);
  assert.equal(afterMidEditArrow.inputFocused, true, `${label}: focus stays in input`);
  assert.equal(afterMidEditArrow.selectionStart, 3, `${label}: ArrowDown must not move text caret`);

  // Press Enter -> activates the selected filtered chat (/app/chat-3) and closes dialog
  await press('\uE006', false, 150);
  const afterSearchEnter = await getSearchState();
  assert.equal(afterSearchEnter.dialogOpen, false, `${label}: Enter activates option and closes dialog`);
  assert.equal(afterSearchEnter.lastOpenedChatHref, '/app/chat-3', `${label}: Enter opened the highlighted chat`);

  // Re-open with Ctrl+K and close with Escape.
  // With Vimium installed and focus in the search <input>, the 1st Escape exits
  // Vimium Insert mode (blurring the input) and the 2nd Escape closes the dialog.
  await pressCtrl('k', 150);
  assert.equal((await getSearchState()).dialogOpen, true, `${label}: Ctrl+K re-opens search dialog`);
  await press('\uE00C', false, 150);
  if ((await getSearchState()).dialogOpen) {
    await press('\uE00C', false, 150);
  }
  assert.equal((await getSearchState()).dialogOpen, false, `${label}: Escape closes search dialog`);

  // --- Real Vimium Extension Inline Citation Chips E2E ---
  const getCitationState = () =>
    evalJson(`(() => {
      const chipZed = document.getElementById('chip-zed');
      const chipAg = document.getElementById('chip-antigravity');
      const dialog = document.querySelector('.cdk-overlay-pane [role="dialog"].hover-card-container');
      const cards = dialog ? Array.from(dialog.querySelectorAll('inline-source-card a')) : [];
      return {
        zedExpanded: chipZed?.getAttribute('aria-expanded') || null,
        agExpanded: chipAg?.getAttribute('aria-expanded') || null,
        activeId: document.activeElement?.id || null,
        dialogChipKey: dialog ? dialog.getAttribute('data-chip-key') : null,
        cardCount: cards.length,
        lastSourceCardHref: window.__lastSourceCardHref || null,
        lastMarkdownLinkClick: window.__lastMarkdownLinkClick || null,
      };
    })()`);

  // Scroll the citation chips back into the viewport (previous Skip-to-Prompt tests scrolled to top)
  // and blur activeElement so Vimium is in Normal mode.
  await evalJson(`(() => {
    const scroller = document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
    scroller.scrollTop = scroller.scrollHeight;
    document.activeElement?.blur?.();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 100));
  const beforeCitation = await getCitationState();
  assert.equal(beforeCitation.dialogChipKey, null, `${label}: no citation dialog open initially`);

  // 1. Real Vimium link-hint click ('f') on collapsed chip opens its dialog via focus()
  await clickViaVimium('#chip-zed');
  const afterZedClick = await getCitationState();
  assert.equal(afterZedClick.activeId, 'chip-zed', `${label}: Vimium hint click focuses chip-zed`);
  assert.equal(afterZedClick.zedExpanded, 'true', `${label}: chip-zed aria-expanded becomes true`);
  assert.equal(afterZedClick.dialogChipKey, 'zed', `${label}: chip-zed sources dialog opens`);
  assert.equal(afterZedClick.cardCount, 1, `${label}: chip-zed dialog renders 1 source card`);

  // 2. Real Vimium link-hint click on a different chip switches directly to the second dialog in one click
  await clickViaVimium('#chip-antigravity');
  const afterAgClick = await getCitationState();
  assert.equal(afterAgClick.activeId, 'chip-antigravity', `${label}: Vimium hint click focuses chip-antigravity`);
  assert.equal(afterAgClick.zedExpanded, 'false', `${label}: chip-zed collapses when switching`);
  assert.equal(afterAgClick.agExpanded, 'true', `${label}: chip-antigravity expands`);
  assert.equal(afterAgClick.dialogChipKey, 'antigravity', `${label}: chip-antigravity dialog opens`);
  assert.equal(afterAgClick.cardCount, 3, `${label}: chip-antigravity dialog renders 3 source cards`);

  // 3. Escape closes the dialog while keeping focus on chip-antigravity; clicking it again via Vimium re-opens it
  await press('\uE00C', false, 150);
  const afterChipEsc = await getCitationState();
  assert.equal(afterChipEsc.dialogChipKey, null, `${label}: Escape closes citation dialog`);
  assert.equal(afterChipEsc.activeId, 'chip-antigravity', `${label}: focus remains on chip-antigravity after Escape`);
  assert.equal(afterChipEsc.agExpanded, 'false', `${label}: chip-antigravity collapsed after Escape`);

  await clickViaVimium('#chip-antigravity');
  const afterReopen = await getCitationState();
  assert.equal(afterReopen.activeId, 'chip-antigravity', `${label}: re-clicking focused collapsed chip keeps focus`);
  assert.equal(afterReopen.agExpanded, 'true', `${label}: re-clicking focused collapsed chip re-opens dialog`);
  assert.equal(afterReopen.dialogChipKey, 'antigravity', `${label}: chip-antigravity dialog re-opened after Escape`);

  // 4. Opened popover <inline-source-card> moves cursor:pointer onto block-level <a> so Vimium hints <a> directly
  const cardLayout = await evalJson(`(() => {
    const card = document.querySelector('.cdk-overlay-pane inline-source-card');
    const link = card ? card.querySelector('a[href]') : null;
    const rects = link ? Array.from(link.getClientRects()).map((r) => ({ w: Math.round(r.width), h: Math.round(r.height) })) : [];
    return {
      cardCursor: card ? getComputedStyle(card).cursor : null,
      linkDisplay: link ? getComputedStyle(link).display : null,
      linkCursor: link ? getComputedStyle(link).cursor : null,
      linkRects: rects,
    };
  })()`);
  assert.equal(cardLayout.cardCursor, 'auto', `${label}: inline-source-card host must not steal cursor:pointer hint`);
  assert.equal(cardLayout.linkDisplay, 'block', `${label}: inline-source-card a[href] must be display:block`);
  assert.equal(cardLayout.linkCursor, 'pointer', `${label}: inline-source-card a[href] must have cursor:pointer`);
  assert.equal(cardLayout.linkRects.length, 1, `${label}: block-level a[href] must produce a single clean client rect`);
  assert.ok(cardLayout.linkRects[0].w > 100 && cardLayout.linkRects[0].h > 20, `${label}: a[href] rect must cover the card`);

  // 5. Real Vimium link-hint clicks on popover source cards (single clean hint per card,
  //    suppressing Vimium's real lastHoveredElement mouseout on chip-antigravity)
  await evalJson(`(() => { window.__lastSourceCardHref = null; return true; })()`);
  await clickViaVimium('.cdk-overlay-pane inline-source-card:nth-of-type(1) a[href]', {
    expectSingleHint: true,
  });
  assert.equal(
    await evalJson(`window.__lastSourceCardHref`),
    'https://antigravity.google/docs/ide/extensions/acp/',
    `${label}: Vimium hint click on 1st popover source link activates it`,
  );

  await evalJson(`(() => { window.__lastSourceCardHref = null; return true; })()`);
  await clickViaVimium('.cdk-overlay-pane inline-source-card:nth-of-type(2) a[href]', {
    expectSingleHint: true,
  });
  assert.equal(
    await evalJson(`window.__lastSourceCardHref`),
    'https://discuss.ai.google.dev/t/acp-clarification/123',
    `${label}: Vimium hint click on 2nd popover source link activates it`,
  );

  // Fallback: synthetic click directly on <inline-source-card> host still forwards to inner a[href]
  await evalJson(`(() => {
    window.__lastSourceCardHref = null;
    const card = document.querySelector('.cdk-overlay-pane inline-source-card:nth-of-type(3)');
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
    return true;
  })()`);
  assert.equal(
    await evalJson(`window.__lastSourceCardHref`),
    'https://layer3labs.io/antigravity-guide',
    `${label}: fallback synthetic click on <inline-source-card> host forwards to inner a[href]`,
  );

  // 6. Real Vimium link-hint click on ordinary inline markdown link (<link-block><a>) is NOT intercepted
  await clickViaVimium('#harness-markdown-link');
  const afterMdLink = await getCitationState();
  assert.deepEqual(
    afterMdLink.lastMarkdownLinkClick,
    { href: 'https://doc.rust-lang.org/book/', isTrusted: false },
    `${label}: Vimium hint click on ordinary markdown link must pass through untouched`,
  );

  // Close dialog cleanly if still open
  if (afterMdLink.dialogChipKey) {
    await press('\uE00C', false, 100);
  }

  console.log(`PASS: ${label}`);
}

async function verifyZeroStateLayout(context, url, label) {
  await send('browsingContext.navigate', { context, url, wait: 'complete' });
  await new Promise((r) => setTimeout(r, 350));

  const r = await send('script.evaluate', {
    expression: `JSON.stringify((() => {
      const container = document.querySelector('input-container');
      const anchor = document.querySelector('div.input-area-container');
      const editor = document.querySelector('.ql-editor');
      const btn = document.querySelector('button[data-gtm-feature="skip-to-previous-prompt"]');
      const cRect = container.getBoundingClientRect();
      const aRect = anchor.getBoundingClientRect();
      const eRect = editor.getBoundingClientRect();
      const bRect = btn ? btn.getBoundingClientRect() : null;
      return {
        anchorPosition: getComputedStyle(anchor).position,
        anchorWidth: Math.round(aRect.width),
        editorWidth: Math.round(eRect.width),
        centerOffset: Math.abs((aRect.left + aRect.width / 2) - (cRect.left + cRect.width / 2)),
        btnExists: Boolean(btn),
        btnRightDelta: bRect ? Math.abs(bRect.right - aRect.right) : null,
      };
    })())`,
    target: { context },
    awaitPromise: true,
  });
  if (r.type === 'exception') {
    throw new Error(`Exception in ${label}: ${JSON.stringify(r.exceptionDetails)}`);
  }
  const state = JSON.parse(r.result.value);

  assert.equal(state.btnExists, true, `${label}: skip button must be mounted`);
  assert.equal(
    state.anchorPosition,
    'absolute',
    `${label}: zero-state input-area-container must preserve position: absolute`,
  );
  assert.ok(
    state.anchorWidth >= 600,
    `${label}: zero-state input pill must not collapse (got width=${state.anchorWidth}px)`,
  );
  assert.ok(
    state.editorWidth >= 300,
    `${label}: zero-state text editor must remain wide (got width=${state.editorWidth}px)`,
  );
  assert.ok(
    state.centerOffset <= 2,
    `${label}: zero-state input pill must remain centered (offset=${state.centerOffset}px)`,
  );
  assert.ok(
    state.btnRightDelta <= 2,
    `${label}: skip button must align with zero-state anchor right edge (delta=${state.btnRightDelta}px)`,
  );

  console.log(`PASS: ${label}`);
}

try {
  await send('session.new', { capabilities: {} });
  const installedVimium = await send('webExtension.install', {
    extensionData: vimiumExtensionData,
  });
  console.log(`Installed Vimium extension: ${installedVimium.extension} (${vimiumExtensionData.path})`);

  const tree = await send('browsingContext.getTree');
  const context = tree.contexts[0].context;

  await verifyVimiumWithoutUserscript(
    context,
    `http://127.0.0.1:${httpPort}/no-userscript`,
    'Firefox + Vimium Baseline (without userscript, confirms reproduction)',
  );
  await verifyScenario(context, `http://127.0.0.1:${httpPort}/`, 'Firefox Direct Page + Vimium');
  await verifyZeroStateLayout(
    context,
    `http://127.0.0.1:${httpPort}/zero-state`,
    'Firefox Zero-State Initial Load Layout',
  );

  await send('webExtension.install', { extensionData: { type: 'path', path: extDir } });
  await verifyScenario(
    context,
    `http://127.0.0.1:${httpPort}/csp`,
    'Firefox WebExtension Content Script + Strict CSP + Vimium',
  );
  await verifyScenario(
    context,
    `http://127.0.0.1:${httpPort}/csp-dev`,
    'Firefox Dev Loader + Strict CSP (Function() blocked) + Vimium',
  );
  console.log('All Firefox E2E tests passed.');
} finally {
  ws.close();
  ff.kill();
  server.close();
  fs.rmSync(tmpBase, { recursive: true, force: true });
}
