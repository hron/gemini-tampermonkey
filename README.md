# Gemini Keyboard Shortcuts (Tampermonkey)

A modular Tampermonkey userscript that adds missing keyboard navigation and shortcuts to [gemini.google.com](https://gemini.google.com).

## Features

### Skip to previous prompt & keyboard scrolling
Replicates Google Search AI Mode's `"Skip to previous prompt"` workflow on Gemini:

- Press **`Shift+Tab`** while focused in the Gemini prompt input to reveal and select the **`↑ Skip to previous prompt`** button above the right side of the input box.
- While `"Skip to previous prompt"` is focused:
  - **`ArrowUp`** / **`ArrowDown`**: scroll the chat output up/down.
  - **`PageUp`** / **`PageDown`**: scroll the chat output up/down by a page.
  - **`Home`** / **`End`**: jump to the top / bottom of the conversation.
  - **`Enter`** / **`Space`** (or click): jump to the previous user prompt above the current scroll position.
  - **`Tab`** or **`Escape`**: return focus directly to the prompt input field.
  - **`Shift+Tab`**: continue backwards to Gemini's `Upload & tools` button (no focus trap).

## Development

Requirements: Node.js (zero external npm dependencies).

```bash
# Build dist/gemini-shortcuts.user.js
npm run build

# Run unit tests
npm test

# Build and test together
npm run check

# Run automated real-Firefox E2E tests (WebDriver BiDi + WebExtension CSP sandbox)
npm run test:firefox

# Run local interactive Gemini DOM verification harness (http://127.0.0.1:4173/)
npm run dev
```

## Installing in Tampermonkey

### Option 1: Direct copy/paste (Firefox, Brave, Chrome)
1. Run `npm run build`.
2. Open Tampermonkey Dashboard → **Create a new script**.
3. Paste the contents of `dist/gemini-shortcuts.user.js` and save.

### Option 2: Live local development via `@require`
> **Note for Firefox users:** Firefox blocks WebExtensions (including Tampermonkey) from loading `file://` URLs. Use the local HTTP dev server (`npm run dev`) instead of `file://` in Firefox!

- **Firefox & Chromium (works everywhere):**
  1. Run `npm run dev` (serves `http://127.0.0.1:4173/dist/gemini-shortcuts.user.js` with `Cache-Control: no-store`).
  2. Create a thin loader script in Tampermonkey:
```js
// ==UserScript==
// @name         Gemini Keyboard Shortcuts (Local Dev)
// @match        https://gemini.google.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// @description  Keyboard shortcuts for Gemini
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @require      http://127.0.0.1:4173/dist/gemini-shortcuts.user.js
// ==/UserScript==
```
  3. In Tampermonkey Settings → **Externals**, set **Update Interval** to `Always` (or bump a query param like `?v=2`) if you want reloads to pick up rebuilt changes immediately.

- **Brave / Chrome only (`file://`):**
  1. Enable **Allow access to file URLs** in Tampermonkey's extension settings.
  2. Use `@require file:///home/algus/src/gemini-tampermonkey/dist/gemini-shortcuts.user.js`.
  3. Run `npm run build` after changes and reload `gemini.google.com`.

## Project Structure

- `src/meta.js` — Tampermonkey metadata header.
- `src/lib/dom.js` — Gemini DOM selectors and helpers.
- `src/lib/scrolling.js` — Pure scrolling & prompt-jump calculations.
- `src/features/` — Individual shortcut features (add new features here).
- `src/main.js` — Feature bootstrapper.
- `scripts/build.mjs` — Zero-dependency bundler generating `dist/gemini-shortcuts.user.js`.
- `test/` — Unit tests (`node --test`).
