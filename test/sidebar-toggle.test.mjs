import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SIDEBAR_TOGGLE_FEATURE_ID,
  createSidebarToggleFeature,
  findSidebarToggleButton,
  isSidebarToggleShortcut,
} from '../src/features/sidebar-toggle.js';

function createFakeElement(
  tag,
  {
    attrs = {},
    classes = [],
    disabled = false,
    hidden = false,
    display = 'block',
    visibility = 'visible',
    rect = { width: 40, height: 40, top: 8, left: 8, right: 48, bottom: 48 },
  } = {},
) {
  const children = [];
  const classSet = new Set(classes);
  const attrMap = new Map(Object.entries(attrs));

  const el = {
    tagName: tag.toUpperCase(),
    children,
    parentElement: null,
    ownerDocument: null,
    disabled,
    hidden,
    _display: display,
    _visibility: visibility,
    _rect: rect,
    clickedCount: 0,
    classList: {
      add(...names) {
        for (const n of names) classSet.add(n);
      },
      remove(...names) {
        for (const n of names) classSet.delete(n);
      },
      contains(name) {
        return classSet.has(name);
      },
    },
    setAttribute(k, v) {
      attrMap.set(k, String(v));
      if (k === 'disabled') el.disabled = true;
      if (k === 'hidden') el.hidden = true;
    },
    getAttribute(k) {
      return attrMap.has(k) ? attrMap.get(k) : null;
    },
    removeAttribute(k) {
      attrMap.delete(k);
      if (k === 'disabled') el.disabled = false;
      if (k === 'hidden') el.hidden = false;
    },
    hasAttribute(k) {
      return attrMap.has(k);
    },
    appendChild(child) {
      child.parentElement = el;
      if (el.ownerDocument) setOwnerDocDeep(child, el.ownerDocument);
      children.push(child);
      return child;
    },
    click() {
      el.clickedCount += 1;
    },
    getBoundingClientRect() {
      return el._rect ? { ...el._rect } : { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    },
    matches(selector) {
      return matchesSelectorList(el, selector);
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (cur.matches && cur.matches(selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const results = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (matchesSelectorList(child, selector)) {
            results.push(child);
          }
          visit(child);
        }
      };
      visit(el);
      return results;
    },
  };
  return el;
}

function setOwnerDocDeep(node, doc) {
  node.ownerDocument = doc;
  for (const child of node.children) {
    setOwnerDocDeep(child, doc);
  }
}

function matchesSimple(el, token) {
  if (!el) return false;
  let rest = token.trim();
  if (!rest) return false;

  const attrRegex = /\[([^\]=]+)(?:="([^"]*)")?\]/g;
  let m;
  while ((m = attrRegex.exec(rest)) !== null) {
    const [, attrName, expected] = m;
    const actual = el.getAttribute(attrName);
    if (expected === undefined) {
      if (actual === null) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  rest = rest.replace(attrRegex, '');

  const classMatches = rest.match(/\.[A-Za-z0-9_-]+/g) || [];
  for (const cls of classMatches) {
    if (!el.classList.contains(cls.slice(1))) return false;
  }
  rest = rest.replace(/\.[A-Za-z0-9_-]+/g, '');

  if (rest && rest !== '*') {
    if (el.tagName !== rest.toUpperCase()) return false;
  }
  return true;
}

function matchesCompoundDescendant(el, selector) {
  const parts = selector.trim().match(/(?:\[[^\]]*\]|\S)+/g) || [];
  if (parts.length === 0) return false;
  if (!matchesSimple(el, parts[parts.length - 1])) return false;
  let cur = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    let matched = false;
    while (cur) {
      if (matchesSimple(cur, parts[i])) {
        matched = true;
        cur = cur.parentElement;
        break;
      }
      cur = cur.parentElement;
    }
    if (!matched) return false;
  }
  return true;
}

function matchesSelectorList(el, selectorList) {
  return selectorList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((part) => matchesCompoundDescendant(el, part));
}

function createFakeEvent(type, props = {}) {
  return {
    type,
    key: '',
    code: '',
    keyCode: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    propagationStopped: false,
    immediatePropagationStopped: false,
    getModifierState() {
      return false;
    },
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    stopImmediatePropagation() {
      this.immediatePropagationStopped = true;
    },
    ...props,
  };
}

function createFakeSidebarEnv({ includeButton = true } = {}) {
  const winListeners = new Map();
  const html = createFakeElement('html');
  const body = createFakeElement('body');
  html.appendChild(body);

  const sidenav = createFakeElement('bard-sidenav');
  const toggleBtn = createFakeElement('button', {
    attrs: {
      type: 'button',
      'data-test-id': 'side-nav-menu-button',
      'aria-label': 'Main menu',
      'aria-expanded': 'true',
    },
    classes: ['side-nav-menu-button'],
  });
  if (includeButton) {
    sidenav.appendChild(toggleBtn);
  }

  const input = createFakeElement('div', {
    classes: ['ql-editor'],
    attrs: { contenteditable: 'true', role: 'textbox', 'aria-label': 'Enter a prompt for Gemini' },
  });
  const dialog = createFakeElement('div', { attrs: { role: 'dialog', 'aria-modal': 'true' } });
  const dialogInput = createFakeElement('input', { attrs: { type: 'search' } });
  dialog.appendChild(dialogInput);

  body.appendChild(sidenav);
  body.appendChild(input);
  body.appendChild(dialog);

  const defaultView = {
    addEventListener(type, fn, options) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push({ fn, capture: Boolean(options?.capture ?? options) });
    },
    removeEventListener(type, fn) {
      if (!winListeners.has(type)) return;
      winListeners.set(type, winListeners.get(type).filter((entry) => entry.fn !== fn));
    },
    dispatchEvent(event) {
      const list = winListeners.get(event.type) ?? [];
      for (const { fn } of list) fn(event);
    },
    getComputedStyle(el) {
      return {
        display: el.hidden ? 'none' : el._display || 'block',
        visibility: el._visibility || 'visible',
      };
    },
  };

  const doc = {
    activeElement: input,
    documentElement: html,
    body,
    defaultView,
    querySelector(sel) {
      return html.querySelector(sel);
    },
    querySelectorAll(sel) {
      return html.querySelectorAll(sel);
    },
  };

  setOwnerDocDeep(html, doc);

  const dispatchKey = (props) => {
    const ev = createFakeEvent('keydown', props);
    defaultView.dispatchEvent(ev);
    return ev;
  };

  return { doc, body, sidenav, toggleBtn, input, dialog, dialogInput, dispatchKey };
}

describe('isSidebarToggleShortcut', () => {
  it('matches Ctrl+B across case and non-Latin layouts via event.code', () => {
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { ctrlKey: true, key: 'b', code: 'KeyB' })), true);
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { ctrlKey: true, key: 'B', code: 'KeyB' })), true);
    // Dvorak layout: key 'b' at a different physical key
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { ctrlKey: true, key: 'b', code: 'KeyN' })), true);
    // Non-Latin layout (e.g. Cyrillic 'и' at physical KeyB)
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { ctrlKey: true, key: 'и', code: 'KeyB' })), true);
  });

  it('rejects other keys, Dvorak physical KeyB collisions, extra modifiers, IME, and AltGraph', () => {
    // Plain 'b' without Ctrl
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { key: 'b', code: 'KeyB' })), false);
    // Dvorak Ctrl+X (physical KeyB but ASCII key 'x') must not trigger Ctrl+B
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { ctrlKey: true, key: 'x', code: 'KeyB' })), false);
    // Extra modifiers (e.g. Ctrl+Shift+B bookmarks bar, Meta+B, Alt+B)
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'B', code: 'KeyB' })), false);
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { ctrlKey: true, altKey: true, key: 'b', code: 'KeyB' })), false);
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { ctrlKey: true, metaKey: true, key: 'b', code: 'KeyB' })), false);
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { metaKey: true, key: 'b', code: 'KeyB' })), false);
    // IME composition and AltGraph
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { ctrlKey: true, key: 'b', code: 'KeyB', isComposing: true })), false);
    assert.equal(isSidebarToggleShortcut(createFakeEvent('keydown', { ctrlKey: true, key: 'b', code: 'KeyB', keyCode: 229 })), false);
    assert.equal(
      isSidebarToggleShortcut(
        createFakeEvent('keydown', {
          ctrlKey: true,
          key: 'b',
          code: 'KeyB',
          getModifierState: (mod) => mod === 'AltGraph',
        }),
      ),
      false,
    );
  });
});

describe('findSidebarToggleButton', () => {
  it('skips hidden/disabled mobile duplicates and returns the visible desktop toggle button', () => {
    const env = createFakeSidebarEnv({ includeButton: false });
    const hiddenMobileHeader = createFakeElement('div', { display: 'none' });
    const hiddenBtn = createFakeElement('button', {
      attrs: { 'data-test-id': 'side-nav-menu-button', 'aria-label': 'Main menu' },
      rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
    });
    hiddenMobileHeader.appendChild(hiddenBtn);

    const disabledBtn = createFakeElement('button', {
      attrs: { 'data-test-id': 'side-nav-menu-button' },
      disabled: true,
    });

    const visibleBtn = createFakeElement('button', {
      attrs: { 'data-test-id': 'side-nav-menu-button', 'aria-label': 'Главное меню' },
    });

    env.body.appendChild(hiddenMobileHeader);
    env.body.appendChild(disabledBtn);
    env.sidenav.appendChild(visibleBtn);

    assert.equal(findSidebarToggleButton(env.doc), visibleBtn);
  });

  it('finds inner button when data-test-id is placed on a wrapper element or falls back to aria-label', () => {
    const env = createFakeSidebarEnv({ includeButton: false });
    const wrapper = createFakeElement('side-nav-menu-button', {
      attrs: { 'data-test-id': 'side-nav-menu-button' },
    });
    const innerBtn = createFakeElement('button', { attrs: { type: 'button' } });
    wrapper.appendChild(innerBtn);
    env.sidenav.appendChild(wrapper);

    assert.equal(findSidebarToggleButton(env.doc), innerBtn);

    // Fallback by aria-label when data-test-id is absent
    const env2 = createFakeSidebarEnv({ includeButton: false });
    const ariaBtn = createFakeElement('button', { attrs: { 'aria-label': 'Main menu' } });
    env2.sidenav.appendChild(ariaBtn);
    assert.equal(findSidebarToggleButton(env2.doc), ariaBtn);
  });

  it('finds live Gemini React sidenav island close/open buttons and skips offscreen or inert drawers', () => {
    const env = createFakeSidebarEnv({ includeButton: false });
    env.doc.defaultView.innerWidth = 1280;

    // Expanded desktop React island button
    const closeBtn = createFakeElement('button', {
      attrs: { 'data-test-id': 'side-nav-close-button', 'aria-label': 'Close sidebar' },
      rect: { width: 36, height: 36, top: 10, left: 200, right: 236, bottom: 46 },
    });
    env.sidenav.appendChild(closeBtn);
    assert.equal(findSidebarToggleButton(env.doc), closeBtn);

    // Collapsed desktop React island swaps test id to side-nav-open-button (32x32 rail button)
    closeBtn.setAttribute('data-test-id', 'side-nav-open-button');
    closeBtn.setAttribute('aria-label', 'Open sidebar');
    closeBtn._rect = { width: 32, height: 32, top: 12, left: 14, right: 46, bottom: 44 };
    assert.equal(findSidebarToggleButton(env.doc), closeBtn);

    // Mobile closed drawer slid offscreen (right <= 0) falls back to onscreen mobile header button
    closeBtn._rect = { width: 36, height: 36, top: 10, left: -240, right: -204, bottom: 46 };
    const sparkleHost = createFakeElement('side-nav-sparkle-button');
    const sparkleBtn = createFakeElement('button', {
      attrs: { type: 'button', 'aria-label': 'Open sidebar' },
      rect: { width: 40, height: 40, top: 8, left: 8, right: 48, bottom: 48 },
    });
    sparkleHost.appendChild(sparkleBtn);
    env.body.appendChild(sparkleHost);
    assert.equal(findSidebarToggleButton(env.doc), sparkleBtn);

    // Inert container is also skipped
    sparkleHost.setAttribute('inert', '');
    const menuBtn = createFakeElement('button', {
      attrs: { 'data-test-id': 'side-nav-menu-button' },
      rect: { width: 40, height: 40, top: 8, left: 8, right: 48, bottom: 48 },
    });
    env.body.appendChild(menuBtn);
    assert.equal(findSidebarToggleButton(env.doc), menuBtn);
  });
});

describe('sidebar-toggle feature', () => {
  it('toggles the sidebar on Ctrl+B while keeping focus in the prompt input', () => {
    const env = createFakeSidebarEnv();
    const feature = createSidebarToggleFeature({ doc: env.doc });
    assert.equal(feature.id, SIDEBAR_TOGGLE_FEATURE_ID);
    feature.init();

    env.doc.activeElement = env.input;
    const ev = env.dispatchKey({ ctrlKey: true, key: 'b', code: 'KeyB', target: env.input });
    assert.equal(ev.defaultPrevented, true);
    assert.equal(ev.propagationStopped, true);
    assert.equal(ev.immediatePropagationStopped, true);
    assert.equal(env.toggleBtn.clickedCount, 1);
    assert.equal(env.doc.activeElement, env.input);

    // Also works when body is focused
    env.doc.activeElement = env.body;
    const ev2 = env.dispatchKey({ ctrlKey: true, key: 'b', code: 'KeyB', target: env.body });
    assert.equal(ev2.defaultPrevented, true);
    assert.equal(env.toggleBtn.clickedCount, 2);

    feature.destroy();
  });

  it('prevents default on held Ctrl+B repeat without toggling repeatedly', () => {
    const env = createFakeSidebarEnv();
    const feature = createSidebarToggleFeature({ doc: env.doc });
    feature.init();

    const initial = env.dispatchKey({ ctrlKey: true, key: 'b', code: 'KeyB', repeat: false, target: env.input });
    const repeated = env.dispatchKey({ ctrlKey: true, key: 'b', code: 'KeyB', repeat: true, target: env.input });

    assert.equal(initial.defaultPrevented, true);
    assert.equal(repeated.defaultPrevented, true);
    assert.equal(repeated.propagationStopped, true);
    assert.equal(env.toggleBtn.clickedCount, 1, 'repeat keydown must not flap the sidebar');

    feature.destroy();
  });

  it('does not trigger inside overlays or when no sidebar toggle button exists', () => {
    const env = createFakeSidebarEnv();
    const feature = createSidebarToggleFeature({ doc: env.doc });
    feature.init();

    env.doc.activeElement = env.dialogInput;
    const overlayEv = env.dispatchKey({ ctrlKey: true, key: 'b', code: 'KeyB', target: env.dialogInput });
    assert.equal(overlayEv.defaultPrevented, false);
    assert.equal(env.toggleBtn.clickedCount, 0);
    feature.destroy();

    const emptyEnv = createFakeSidebarEnv({ includeButton: false });
    const emptyFeature = createSidebarToggleFeature({ doc: emptyEnv.doc });
    emptyFeature.init();

    const noBtnEv = emptyEnv.dispatchKey({ ctrlKey: true, key: 'b', code: 'KeyB', target: emptyEnv.input });
    assert.equal(noBtnEv.defaultPrevented, false);
    emptyFeature.destroy();
  });

  it('removes listeners cleanly on destroy()', () => {
    const env = createFakeSidebarEnv();
    const feature = createSidebarToggleFeature({ doc: env.doc });
    feature.init();
    feature.destroy();

    const ev = env.dispatchKey({ ctrlKey: true, key: 'b', code: 'KeyB', target: env.input });
    assert.equal(ev.defaultPrevented, false);
    assert.equal(env.toggleBtn.clickedCount, 0);
  });
});
