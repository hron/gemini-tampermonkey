const REPO_URL = 'https://github.com/hron/gemini-tampermonkey';
const RELEASE_DOWNLOAD_BASE = `${REPO_URL}/releases/latest/download`;

export function createUserscriptHeader({ version }) {
  if (!version || typeof version !== 'string') {
    throw new Error('createUserscriptHeader requires a non-empty version string');
  }

  return `// ==UserScript==
// @name         Gemini Keyboard Shortcuts
// @namespace    ${REPO_URL}
// @version      ${version}
// @description  Adds missing keyboard shortcuts to gemini.google.com, including full keyboard navigation for the Ctrl+K search dialog, smooth PageUp/PageDown scrolling while the prompt input is focused, and Google AI Mode's "Skip to previous prompt".
// @author       Aleksei Gusev
// @homepageURL  ${REPO_URL}
// @supportURL   ${REPO_URL}/issues
// @downloadURL  ${RELEASE_DOWNLOAD_BASE}/gemini-shortcuts.user.js
// @updateURL    ${RELEASE_DOWNLOAD_BASE}/gemini-shortcuts.meta.js
// @match        https://gemini.google.com/*
// @grant        GM_addStyle
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @run-at       document-idle
// ==/UserScript==`;
}
