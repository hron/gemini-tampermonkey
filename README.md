# Gemini Keyboard Shortcuts (Tampermonkey)

A modular Tampermonkey userscript that adds missing keyboard navigation and shortcuts to [gemini.google.com](https://gemini.google.com).

## Features

### Keyboard navigation for the `Ctrl+K` Search Chats dialog
Turns Gemini's `Ctrl+K` (`Search chats`) dialog into a keyboard-first command palette without stealing focus from the search input:

- The top matching chat is automatically highlighted as soon as the dialog opens or search results update.
- **`ArrowUp`** / **`ArrowDown`** (and **`PageUp`** / **`PageDown`**): move selection through recent chats and search results while keeping the active item scrolled into view.
- Keyboard focus stays strictly inside the search input so you can continue typing, editing, moving the text cursor (`ArrowLeft` / `ArrowRight`), or selecting text without interruption.
- **`Enter`**: opens the currently highlighted chat immediately (while leaving `Clear search` / `Close` buttons working natively if tabbed to).
- Mouse hover stays in sync with keyboard selection without stationary cursors stealing focus during scrolling, and infinite scroll preserves your current selection.

### Smooth `PageUp` / `PageDown` scrolling while input is focused
Scroll the Gemini conversation smoothly without leaving the prompt input:

- Press **`PageUp`** / **`PageDown`** while focused in the prompt input (or anywhere in the chat) to smoothly scroll the chat history by a page while keeping focus in the prompt box.
- Rapid taps accumulate smoothly without losing distance, and holding **`PageUp`** / **`PageDown`** transitions into continuous smooth scrolling that coasts to a stop on release.
- Modifier combos like **`Shift+PageUp`** / **`Shift+PageDown`** (text selection) and **`Ctrl+PageUp`** / **`Ctrl+PageDown`** (tab switching), as well as dialogs, menus, sidebar scrolling, and inline edit fields, are left untouched.

### Skip to previous prompt & keyboard scrolling
Replicates Google Search AI Mode's `"Skip to previous prompt"` workflow on Gemini, plus direct prompt-to-prompt jumping:

- Press **`Ctrl+Alt+[`** / **`Ctrl+Alt+]`** while focused in the Gemini prompt input to smoothly jump to the previous / next user prompt without leaving the input field.
- Press **`Shift+Tab`** while focused in the Gemini prompt input to reveal and select the **`↑ Skip to previous prompt`** button above the right side of the input box.
- While `"Skip to previous prompt"` is focused:
  - **`ArrowUp`** / **`ArrowDown`**: scroll the chat output up/down.
  - **`Shift+ArrowUp`** / **`Shift+ArrowDown`**: jump to the previous / next user prompt.
  - **`PageUp`** / **`PageDown`**: scroll the chat output up/down by a page.
  - **`Home`** / **`End`**: jump to the top / bottom of the conversation.
  - **`Enter`** / **`Space`** (or click): jump to the previous user prompt above the current scroll position.
  - **`Tab`** or **`Escape`**: return focus directly to the prompt input field.
  - **`Shift+Tab`**: continue backwards to Gemini's `Upload & tools` button (no focus trap).

### Vimium-friendly inline citation chips
Gemini's inline source chips (e.g. `Google Antigravity`, `Google Antigravity · + 2`) are `<button>` elements whose sources popover opens on `focus` or `mouseenter` (not on `click`) and tears down on `mouseout`. When Vimium clicks a chip, it doesn't focus the button and records the chip as `lastHoveredElement` — so clicking a link inside the opened popover dispatches a synthetic `mouseout` on the chip first, closing the popover and detaching the link before `click` even fires. The script intercepts only synthetic hover/unhover, pointer, and click events on `<source-inline-chip>` buttons to open/switch popovers via `focus()` and keep them open while Vimium activates links inside the popover, while also styling `inline-source-card a[href]` as a clean block-level pointer target and leaving real mouse interactions untouched.

## Development

Requirements: Node.js (zero external npm dependencies).

```bash
# Build dist/gemini-shortcuts.user.js
npm run build

# Run unit tests
npm test

# Build and test together
npm run check

# Run automated real-Firefox E2E tests (WebDriver BiDi + WebExtension CSP sandbox + bundled Vimium extension)
npm run test:firefox

# Optional: run Firefox E2E against a custom Vimium .xpi or unpacked extension directory
VIMIUM_EXTENSION_PATH=/path/to/vimium.xpi npm run test:firefox

# Run local interactive Gemini DOM verification harness (http://127.0.0.1:4173/)
npm run dev
```

## Installing in Tampermonkey

### Option 1: 1-Click Install from GitHub Releases (Recommended)
1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open the latest release userscript:
   **[Install Gemini Keyboard Shortcuts](https://github.com/hron/gemini-tampermonkey/releases/latest/download/gemini-shortcuts.user.js)**
3. Click **Install** in the Tampermonkey prompt. Future releases update automatically via `@updateURL` / `@downloadURL`.

### Option 2: Direct copy/paste (Firefox, Brave, Chrome)
1. Run `npm run build`.
2. Open Tampermonkey Dashboard → **Create a new script**.
3. Paste the contents of `dist/gemini-shortcuts.user.js` and save.

### Option 3: Live local development (Firefox & Chromium, no caching)
Tampermonkey caches `@require` scripts internally and does not refetch them on page reload. Instead, `npm run dev` serves a separate **`(Local Dev)`** loader userscript that fetches a freshly rebuilt bundle from `127.0.0.1:4173` on every page load via `GM_xmlhttpRequest` (so edits take effect immediately on `F5`, and you can keep your stable script installed and simply toggle between them in Tampermonkey):

1. Start the dev server (rebuilds from `src/` automatically on every request):
   ```bash
   npm run dev
   ```
2. Open **`http://127.0.0.1:4173/dev-loader.user.js`** in your browser and click **Install** in Tampermonkey.
3. In the Tampermonkey Dashboard, disable the stable **Gemini Keyboard Shortcuts** script and enable **Gemini Keyboard Shortcuts (Local Dev)** while testing.
4. Edit files in `src/` and reload `gemini.google.com` — DevTools Console logs `[GTM Dev] Loaded fresh build (<hash>, <bytes>B)` on each reload (or warns if `npm run dev` isn't running).

## Releasing

Releases are built, verified (unit + Firefox E2E tests), and published automatically by GitHub Actions when a `v*.*.*` tag is pushed:

```bash
npm version patch   # or minor / major (updates package.json and creates a vX.Y.Z tag)
git push origin main --follow-tags
```

## Project Structure

- `src/meta.js` — Tampermonkey metadata header generator (reads version from `package.json`).
- `src/lib/dom.js` — Gemini DOM selectors and helpers.
- `src/lib/scrolling.js` — Pure scrolling & prompt-jump calculations.
- `src/features/` — Individual shortcut features (add new features here).
- `src/main.js` — Feature bootstrapper.
- `scripts/build.mjs` — Zero-dependency bundler generating `dist/gemini-shortcuts.user.js` and `dist/gemini-shortcuts.meta.js`.
- `test/` — Unit tests (`node --test`).
