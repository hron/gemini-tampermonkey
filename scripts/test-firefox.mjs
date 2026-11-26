import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { createDevLoaderScript } from './dev-server.mjs';

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

  // Re-open with Ctrl+K and close with Escape
  await pressCtrl('k', 150);
  assert.equal((await getSearchState()).dialogOpen, true, `${label}: Ctrl+K re-opens search dialog`);
  await press('\uE00C', false, 150);
  assert.equal((await getSearchState()).dialogOpen, false, `${label}: Escape closes search dialog`);

  // --- Vimium-Friendly Inline Citation Chips E2E ---
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
        lastMarkdownLinkClick: window.__lastMarkdownLinkClick || null,
      };
    })()`);

  // Mirror Vimium's DomUtils.simulateClick + DomUtils.simulateMouseEvent:
  // on mouseover, Vimium first dispatches synthetic mouseout on lastHoveredElement!
  const simulateVimiumClick = (selector) =>
    evalJson(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const opts = { bubbles: true, cancelable: true, composed: true, view: window, detail: 1 };
      el.dispatchEvent(new MouseEvent('pointerover', opts));
      if (window.__vimiumLastHovered) {
        window.__vimiumLastHovered.dispatchEvent(new MouseEvent('mouseout', opts));
      }
      window.__vimiumLastHovered = el;
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    })()`);

  // Ensure no chip is focused initially
  await evalJson(`(() => { document.activeElement?.blur?.(); return true; })()`);
  const beforeCitation = await getCitationState();
  assert.equal(beforeCitation.dialogChipKey, null, `${label}: no citation dialog open initially`);

  // 1. Vimium synthetic click on inner span of collapsed chip opens its dialog via focus()
  assert.equal(await simulateVimiumClick('#chip-zed .source-title'), true);
  const afterZedClick = await getCitationState();
  assert.equal(afterZedClick.activeId, 'chip-zed', `${label}: Vimium click focuses chip-zed`);
  assert.equal(afterZedClick.zedExpanded, 'true', `${label}: chip-zed aria-expanded becomes true`);
  assert.equal(afterZedClick.dialogChipKey, 'zed', `${label}: chip-zed sources dialog opens`);
  assert.equal(afterZedClick.cardCount, 1, `${label}: chip-zed dialog renders 1 source card`);

  // 2. Vimium synthetic click on a different chip switches directly to the second dialog in one click
  assert.equal(await simulateVimiumClick('#chip-antigravity'), true);
  const afterAgClick = await getCitationState();
  assert.equal(afterAgClick.activeId, 'chip-antigravity', `${label}: Vimium click focuses chip-antigravity`);
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

  assert.equal(await simulateVimiumClick('#chip-antigravity'), true);
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

  // 5. Vimium synthetic click on popover link (<a> directly) AND fallback on <inline-source-card> host both activate the link
  await evalJson(`(() => { window.__lastSourceCardHref = null; return true; })()`);
  assert.equal(await simulateVimiumClick('.cdk-overlay-pane inline-source-card a[href]'), true);
  assert.equal(
    await evalJson(`window.__lastSourceCardHref`),
    'https://antigravity.google/docs/ide/extensions/acp/',
    `${label}: Vimium synthetic click on popover a[href] activates the source link`,
  );

  await evalJson(`(() => { window.__lastSourceCardHref = null; return true; })()`);
  assert.equal(await simulateVimiumClick('.cdk-overlay-pane inline-source-card:nth-of-type(2)'), true);
  assert.equal(
    await evalJson(`window.__lastSourceCardHref`),
    'https://discuss.ai.google.dev/t/acp-clarification/123',
    `${label}: fallback synthetic click on <inline-source-card> host forwards to inner a[href]`,
  );

  // 6. Synthetic click on ordinary inline markdown link (<link-block><a>) is NOT intercepted
  assert.equal(await simulateVimiumClick('#harness-markdown-link'), true);
  const afterMdLink = await getCitationState();
  assert.deepEqual(
    afterMdLink.lastMarkdownLinkClick,
    { href: 'https://doc.rust-lang.org/book/', isTrusted: false },
    `${label}: synthetic click on ordinary markdown link must pass through untouched`,
  );

  // Close dialog cleanly
  await press('\uE00C', false, 100);

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
  const tree = await send('browsingContext.getTree');
  const context = tree.contexts[0].context;

  await verifyScenario(context, `http://127.0.0.1:${httpPort}/`, 'Firefox Direct Page');
  await verifyZeroStateLayout(
    context,
    `http://127.0.0.1:${httpPort}/zero-state`,
    'Firefox Zero-State Initial Load Layout',
  );

  await send('webExtension.install', { extensionData: { type: 'path', path: extDir } });
  await verifyScenario(
    context,
    `http://127.0.0.1:${httpPort}/csp`,
    'Firefox WebExtension Content Script + Strict CSP',
  );
  await verifyScenario(
    context,
    `http://127.0.0.1:${httpPort}/csp-dev`,
    'Firefox Dev Loader + Strict CSP (Function() blocked)',
  );
  console.log('All Firefox E2E tests passed.');
} finally {
  ws.close();
  ff.kill();
  server.close();
  fs.rmSync(tmpBase, { recursive: true, force: true });
}
