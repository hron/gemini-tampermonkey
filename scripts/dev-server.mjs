import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildUserscript } from './build.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const HARNESS_FILE = path.join(ROOT_DIR, 'test/fixture/gemini-harness.html');
const PORT = Number(process.env.PORT || 4173);

export function createDevLoaderScript({ port = PORT } = {}) {
  const bundleUrl = `http://127.0.0.1:${port}/dist/gemini-shortcuts.user.js`;
  return `// ==UserScript==
// @name         Gemini Keyboard Shortcuts (Local Dev)
// @namespace    https://github.com/hron/gemini-tampermonkey#dev
// @version      0.0.1-dev
// @description  Live local dev loader for Gemini Keyboard Shortcuts (fetches a fresh build on every page load via GM_xmlhttpRequest, bypassing Tampermonkey @require caching).
// @author       Aleksei Gusev
// @match        https://gemini.google.com/*
// @grant        GM_addElement
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEV_URL = '${bundleUrl}';

  if (typeof GM_xmlhttpRequest !== 'function') {
    console.error('[GTM Dev] GM_xmlhttpRequest is unavailable. Check @grant metadata.');
    return;
  }

  function findPageScriptNonce() {
    const scripts = document.querySelectorAll('script[nonce]');
    for (const el of scripts) {
      const nonce = el.nonce || el.getAttribute('nonce');
      if (nonce) return nonce;
    }
    return '';
  }

  function buildBridgedBundle(source, styleEventName, ackEventName) {
    return (
      '(function () {\\n' +
      '  document.dispatchEvent(new Event(' + JSON.stringify(ackEventName) + '));\\n' +
      '  var GM_addStyle = function (css) {\\n' +
      '    document.dispatchEvent(new CustomEvent(' + JSON.stringify(styleEventName) + ', { detail: css }));\\n' +
      '  };\\n' +
      source +
      '\\n})();\\n//# sourceURL=' + DEV_URL
    );
  }

  function executeBundle(source) {
    const suffix = Math.random().toString(36).slice(2);
    const styleEventName = 'gtm-dev-add-style-' + suffix;
    const ackEventName = 'gtm-dev-exec-' + suffix;
    let executed = false;

    if (typeof GM_addStyle === 'function') {
      document.addEventListener(styleEventName, (ev) => {
        if (ev && typeof ev.detail === 'string') {
          GM_addStyle(ev.detail);
        }
      });
    }
    document.addEventListener(
      ackEventName,
      () => {
        executed = true;
      },
      { once: true },
    );

    const bridgedSource = buildBridgedBundle(source, styleEventName, ackEventName);
    const nonce = findPageScriptNonce();
    const errors = [];

    // Strategy 1: GM_addElement('script', ...) with page CSP nonce (CSP + Trusted Types safe in Firefox/Chrome)
    if (typeof GM_addElement === 'function') {
      try {
        const attrs = { textContent: bridgedSource };
        if (nonce) attrs.nonce = nonce;
        const el = GM_addElement('script', attrs);
        if (el && typeof el.remove === 'function') el.remove();
        if (executed) return 'GM_addElement';
      } catch (err) {
        errors.push(err);
      }
    }

    // Strategy 2: Direct <script nonce="..."> DOM injection
    try {
      const s = document.createElement('script');
      if (nonce) s.setAttribute('nonce', nonce);
      s.textContent = bridgedSource;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
      if (executed) return 'script-nonce';
    } catch (err) {
      errors.push(err);
    }

    // Strategy 3: Fallback to sandbox Function() when CSP allows unsafe-eval
    try {
      const gmAddStyle = typeof GM_addStyle === 'function' ? GM_addStyle : undefined;
      const pageCloneInto = typeof cloneInto === 'function' ? cloneInto : undefined;
      new Function('GM_addStyle', 'cloneInto', source + '\\n//# sourceURL=' + DEV_URL)(
        gmAddStyle,
        pageCloneInto,
      );
      return 'Function';
    } catch (err) {
      errors.push(err);
    }

    throw errors[0] || new Error('Blocked by page Content Security Policy');
  }

  GM_xmlhttpRequest({
    method: 'GET',
    url: DEV_URL + '?t=' + Date.now(),
    nocache: true,
    onload(res) {
      if (res.status !== 200) {
        console.error('[GTM Dev] Failed to fetch dev bundle:', res.status, DEV_URL);
        return;
      }
      const buildHash = res.responseHeaders?.match(/^x-gtm-build-hash:\\s*(.+)$/im)?.[1]?.trim() || 'unknown';
      try {
        const mode = executeBundle(res.responseText);
        console.info(
          '[GTM Dev] Loaded fresh build (' + buildHash + ', ' + res.responseText.length + 'B via ' + mode + ') from ' + DEV_URL,
        );
      } catch (err) {
        console.error('[GTM Dev] Failed to execute dev bundle:', err);
      }
    },
    onerror(err) {
      console.warn('[GTM Dev] Local dev server is not reachable at ' + DEV_URL + '. Run \`npm run dev\`.', err);
    },
  });
})();
`;
}

export function createDevServer({ port = PORT, log = false } = {}) {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];

    if (urlPath === '/') {
      if (!fs.existsSync(HARNESS_FILE)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      fs.createReadStream(HARNESS_FILE).pipe(res);
      return;
    }

    if (urlPath === '/dev-loader.user.js') {
      const addr = server.address();
      const activePort = addr && typeof addr === 'object' ? addr.port : port;
      const loader = createDevLoaderScript({ port: activePort });
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(loader);
      return;
    }

    if (urlPath === '/dist/gemini-shortcuts.user.js') {
      try {
        const { bundle } = buildUserscript({ write: true, log: false });
        const hash = crypto.createHash('sha256').update(bundle).digest('hex').slice(0, 8);
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
          'X-Gtm-Build-Hash': hash,
        });
        res.end(bundle);
        if (log) {
          console.log(`[dev] Served fresh build (${hash}, ${bundle.length} bytes)`);
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Build failed: ${err.message}`);
        if (log) {
          console.error('[dev] Build failed:', err);
        }
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  return server;
}

function startServer() {
  const server = createDevServer({ port: PORT, log: true });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Gemini shortcuts dev server listening at http://127.0.0.1:${PORT}/`);
    console.log(`  1-click Tampermonkey dev loader: http://127.0.0.1:${PORT}/dev-loader.user.js`);
    console.log(`  Live-rebuilt userscript bundle:  http://127.0.0.1:${PORT}/dist/gemini-shortcuts.user.js`);
    console.log(`  Local DOM test harness:          http://127.0.0.1:${PORT}/`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
