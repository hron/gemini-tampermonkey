import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEARCH_ACTIVE_ATTR,
  SEARCH_DIALOG_FEATURE_ID,
  computeNextOptionIndex,
  createSearchDialogFeature,
  findSearchDialog,
  findSearchDialogOptions,
} from '../src/features/search-dialog.js';

function createFakeNode(
  tag,
  {
    attrs = {},
    classes = [],
    textContent = '',
    scrollTop = 0,
    clientHeight = 400,
    scrollHeight = 400,
    overflowY = 'visible',
    rect = null,
    value = '',
    disabled = false,
    hidden = false,
  } = {},
) {
  const children = [];
  const classSet = new Set(classes);
  const attrMap = new Map(Object.entries(attrs));
  const listeners = new Map();

  const el = {
    tagName: tag.toUpperCase(),
    children,
    parentElement: null,
    ownerDocument: null,
    textContent,
    value,
    disabled,
    hidden,
    scrollTop,
    clientHeight,
    scrollHeight,
    _overflowY: overflowY,
    _rect: rect || { top: 0, bottom: 48, left: 0, right: 600, height: 48, width: 600 },
    clickedCount: 0,
    focusedCount: 0,
    scrollIntoViewCalls: [],
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
      if (k === 'id') el.id = String(v);
      if (k === 'disabled') el.disabled = true;
      if (k === 'hidden') el.hidden = true;
    },
    getAttribute(k) {
      return attrMap.has(k) ? attrMap.get(k) : null;
    },
    removeAttribute(k) {
      attrMap.delete(k);
      if (k === 'id') el.id = '';
      if (k === 'disabled') el.disabled = false;
      if (k === 'hidden') el.hidden = false;
    },
    hasAttribute(k) {
      return attrMap.has(k);
    },
    get id() {
      return attrMap.get('id') || '';
    },
    set id(v) {
      if (v) attrMap.set('id', String(v));
      else attrMap.delete('id');
    },
    get href() {
      return attrMap.get('href') || '';
    },
    appendChild(child) {
      if (child.parentElement) {
        const idx = child.parentElement.children.indexOf(child);
        if (idx >= 0) child.parentElement.children.splice(idx, 1);
      }
      child.parentElement = el;
      if (el.ownerDocument) setOwnerDocDeep(child, el.ownerDocument);
      children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx >= 0) {
        children.splice(idx, 1);
        child.parentElement = null;
      }
      return child;
    },
    remove() {
      if (el.parentElement) {
        el.parentElement.removeChild(el);
      }
    },
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === el) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    addEventListener(type, fn, options) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, capture: Boolean(options?.capture ?? options) });
    },
    removeEventListener(type, fn) {
      if (!listeners.has(type)) return;
      listeners.set(type, listeners.get(type).filter((entry) => entry.fn !== fn));
    },
    dispatchEvent(event) {
      const targetEvent = { target: el, ...event };
      const list = listeners.get(targetEvent.type) ?? [];
      for (const { fn } of list) fn(targetEvent);
      return targetEvent;
    },
    focus() {
      el.focusedCount += 1;
      if (el.ownerDocument) {
        el.ownerDocument.activeElement = el;
      }
    },
    click() {
      el.clickedCount += 1;
    },
    getBoundingClientRect() {
      return { ...el._rect };
    },
    scrollIntoView(opts) {
      el.scrollIntoViewCalls.push(opts);
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
      const all = el.querySelectorAll(selector);
      return all[0] || null;
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

  if (attrs.id) el.id = attrs.id;
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

  // Handle :not([disabled])
  if (rest.includes(':not([disabled])')) {
    if (el.disabled || el.hasAttribute('disabled')) return false;
    rest = rest.replace(':not([disabled])', '');
  }
  if (rest.includes(':not([type="hidden"])')) {
    if (el.getAttribute('type') === 'hidden') return false;
    rest = rest.replace(':not([type="hidden"])', '');
  }

  // Extract attribute selectors
  const attrRegex = /\[([^\]=^$*]+)(?:(\^|\$|\*)?="([^"]*)")?\]/g;
  let m;
  while ((m = attrRegex.exec(rest)) !== null) {
    const [, attrName, op, expected] = m;
    const actual = el.getAttribute(attrName);
    if (expected === undefined) {
      if (actual === null) return false;
    } else if (op === '^') {
      if (actual === null || !actual.startsWith(expected)) return false;
    } else if (op === '$') {
      if (actual === null || !actual.endsWith(expected)) return false;
    } else if (op === '*') {
      if (actual === null || !actual.includes(expected)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  rest = rest.replace(attrRegex, '');

  // Extract classes
  const classMatches = rest.match(/\.[A-Za-z0-9_-]+/g) || [];
  for (const cls of classMatches) {
    if (!el.classList.contains(cls.slice(1))) return false;
  }
  rest = rest.replace(/\.[A-Za-z0-9_-]+/g, '');

  // Remaining tag name
  if (rest && rest !== '*') {
    if (el.tagName !== rest.toUpperCase()) return false;
  }
  return true;
}

function matchesCompoundDescendant(el, selector) {
  const parts = selector.trim().split(/\s+/);
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
  const parts = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.some((part) => matchesCompoundDescendant(el, part));
}

function createFakeEvent(type, props = {}) {
  return {
    type,
    key: '',
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

function createFakeGeminiSearchEnv({ chatCount = 5, withViewport = true } = {}) {
  const winListeners = new Map();
  const docListeners = new Map();

  const html = createFakeNode('html');
  const head = createFakeNode('head');
  const body = createFakeNode('body');
  html.appendChild(head);
  html.appendChild(body);

  const defaultView = {
    addEventListener(type, fn, options) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push({ fn, capture: Boolean(options?.capture ?? options) });
    },
    removeEventListener(type, fn) {
      if (!winListeners.has(type)) return;
      winListeners.set(type, winListeners.get(type).filter((e) => e.fn !== fn));
    },
    dispatchEvent(event) {
      const list = winListeners.get(event.type) ?? [];
      for (const { fn } of list) fn(event);
    },
    getComputedStyle(el) {
      return {
        overflowY: el._overflowY || 'visible',
        display: el.hidden ? 'none' : 'block',
        visibility: 'visible',
      };
    },
  };

  const doc = {
    activeElement: body,
    documentElement: html,
    head,
    body,
    defaultView,
    createElement(tag) {
      const node = createFakeNode(tag);
      node.ownerDocument = doc;
      return node;
    },
    querySelector(sel) {
      return html.querySelector(sel);
    },
    querySelectorAll(sel) {
      return html.querySelectorAll(sel);
    },
    addEventListener(type, fn, options) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push({ fn, capture: Boolean(options?.capture ?? options) });
    },
    removeEventListener(type, fn) {
      if (!docListeners.has(type)) return;
      docListeners.set(type, docListeners.get(type).filter((e) => e.fn !== fn));
    },
    dispatchEvent(event) {
      const list = docListeners.get(event.type) ?? [];
      for (const { fn } of list) fn(event);
    },
  };

  setOwnerDocDeep(html, doc);

  function mountSearchDialog({ titles, rowHeight = 48, viewportHeight = 144 } = {}) {
    const itemTitles =
      titles || Array.from({ length: chatCount }, (_, i) => `Chat Title ${i + 1}`);

    const portal = createFakeNode('div', { attrs: { 'data-base-ui-portal': '' } });
    const backdrop = createFakeNode('div', { attrs: { role: 'presentation', 'data-open': '' } });
    const dialog = createFakeNode('div', {
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Search chats',
        tabindex: '-1',
        'data-open': '',
      },
    });
    const searchSection = createFakeNode('section', {
      attrs: { role: 'search', 'aria-label': 'Search chats' },
    });
    const topBar = createFakeNode('div');
    const input = createFakeNode('input', {
      attrs: {
        type: 'search',
        'aria-label': 'Search chats',
        placeholder: 'Search chats',
        autocomplete: 'off',
      },
    });
    const clearBtn = createFakeNode('button', {
      attrs: { type: 'button', 'aria-label': 'Clear search' },
      textContent: 'Clear',
    });
    const closeBtn = createFakeNode('button', {
      attrs: { type: 'button', 'aria-label': 'Close' },
      textContent: 'close',
    });
    topBar.appendChild(input);
    topBar.appendChild(clearBtn);
    topBar.appendChild(closeBtn);

    const resultsSection = createFakeNode('section');
    const heading = createFakeNode('h2', { textContent: 'Recents' });
    resultsSection.appendChild(heading);

    const viewport = createFakeNode('div', {
      attrs: {
        'data-id': 'base-ui-_r_6_-viewport',
        tabindex: '0',
      },
      classes: ['base-ui-disable-scrollbar'],
      scrollTop: 0,
      clientHeight: viewportHeight,
      scrollHeight: Math.max(viewportHeight, itemTitles.length * rowHeight),
      overflowY: withViewport ? 'scroll' : 'visible',
      rect: { top: 100, bottom: 100 + viewportHeight, left: 310, right: 970, height: viewportHeight, width: 660 },
    });

    const ul = createFakeNode('ul');

    function populateItems(newTitles) {
      ul.children.length = 0;
      const links = [];
      newTitles.forEach((title, i) => {
        const li = createFakeNode('li');
        const link = createFakeNode('a', {
          attrs: { href: `/app/chat-${i + 1}` },
          textContent: title,
          rect: {
            top: 100 + i * rowHeight - viewport.scrollTop,
            bottom: 100 + (i + 1) * rowHeight - viewport.scrollTop,
            left: 320,
            right: 960,
            height: rowHeight,
            width: 640,
          },
        });
        // Dynamic getBoundingClientRect reflecting viewport.scrollTop
        link.getBoundingClientRect = () => ({
          top: 100 + i * rowHeight - viewport.scrollTop,
          bottom: 100 + (i + 1) * rowHeight - viewport.scrollTop,
          left: 320,
          right: 960,
          height: rowHeight,
          width: 640,
        });
        li.appendChild(link);
        ul.appendChild(li);
        links.push(link);
      });
      // Trailing empty infinite-scroll sentinel <li></li> just like real Gemini
      ul.appendChild(createFakeNode('li'));
      viewport.scrollHeight = Math.max(viewportHeight, newTitles.length * rowHeight);
      return links;
    }

    const links = populateItems(itemTitles);

    viewport.appendChild(ul);
    resultsSection.appendChild(viewport);
    searchSection.appendChild(topBar);
    searchSection.appendChild(resultsSection);
    dialog.appendChild(searchSection);
    backdrop.appendChild(dialog);
    portal.appendChild(backdrop);
    body.appendChild(portal);

    doc.activeElement = input;

    return {
      portal,
      dialog,
      searchSection,
      input,
      clearBtn,
      closeBtn,
      resultsSection,
      viewport,
      ul,
      links,
      populateItems,
      rowHeight,
    };
  }

  const dispatchKey = (type, props) => {
    const ev = createFakeEvent(type, props);
    defaultView.dispatchEvent(ev);
    return ev;
  };

  return { doc, body, head, defaultView, mountSearchDialog, dispatchKey };
}

describe('computeNextOptionIndex', () => {
  it('returns -1 when option list is empty', () => {
    assert.equal(computeNextOptionIndex(0, 0, 1), -1);
    assert.equal(computeNextOptionIndex(-1, 0, -1), -1);
  });

  it('moves forward and backward and wraps on non-repeat boundary taps', () => {
    assert.equal(computeNextOptionIndex(0, 4, 1, { wrap: true }), 1);
    assert.equal(computeNextOptionIndex(3, 4, 1, { wrap: true }), 0);
    assert.equal(computeNextOptionIndex(0, 4, -1, { wrap: true }), 3);
    assert.equal(computeNextOptionIndex(2, 4, -1, { wrap: true }), 1);
  });

  it('clamps at boundaries when wrap is false (held key repeat / PageUp / PageDown)', () => {
    assert.equal(computeNextOptionIndex(3, 4, 1, { wrap: false }), 3);
    assert.equal(computeNextOptionIndex(0, 4, -1, { wrap: false }), 0);
    assert.equal(computeNextOptionIndex(1, 5, 10, { wrap: false }), 4);
    assert.equal(computeNextOptionIndex(3, 5, -10, { wrap: false }), 0);
  });
});

describe('search-dialog DOM discovery', () => {
  it('finds locale-independent Search dialog and excludes empty sentinel li and header buttons', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 3 });
    const mounted = env.mountSearchDialog();
    // Change aria-label to non-English to confirm locale independence
    mounted.dialog.setAttribute('aria-label', 'Поиск чатов');
    mounted.searchSection.setAttribute('aria-label', 'Поиск чатов');

    const found = findSearchDialog(env.doc);
    assert.ok(found);
    assert.equal(found.dialog, mounted.dialog);
    assert.equal(found.input, mounted.input);

    const options = findSearchDialogOptions(found.dialog, found.input);
    assert.equal(options.length, 3);
    assert.deepEqual(options, mounted.links);
  });

  it('ignores non-search dialogs (e.g. Delete confirmation modal)', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 0 });
    const confirmDialog = createFakeNode('div', {
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Delete chat?' },
    });
    confirmDialog.appendChild(createFakeNode('button', { textContent: 'Cancel' }));
    confirmDialog.appendChild(createFakeNode('button', { textContent: 'Delete' }));
    env.body.appendChild(confirmDialog);

    assert.equal(findSearchDialog(env.doc), null);
  });

  it('ignores secondary action buttons inside an li that already contains a chat link', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 2 });
    const mounted = env.mountSearchDialog();
    const menuBtn = createFakeNode('button', { attrs: { type: 'button', 'aria-label': 'More options' } });
    mounted.links[0].parentElement.appendChild(menuBtn);

    const options = findSearchDialogOptions(mounted.dialog, mounted.input);
    assert.equal(options.length, 2);
    assert.equal(options.includes(menuBtn), false);
  });
});

describe('search-dialog feature', () => {
  it('highlights the first option on open while keeping keyboard focus in the search input', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 4 });
    const mounted = env.mountSearchDialog();
    const feature = createSearchDialogFeature({ doc: env.doc, observe: false });
    assert.equal(feature.id, SEARCH_DIALOG_FEATURE_ID);
    feature.init();

    assert.equal(env.doc.activeElement, mounted.input, 'focus must stay in search input');
    assert.equal(mounted.links[0].getAttribute(SEARCH_ACTIVE_ATTR), 'true');
    assert.equal(mounted.links[0].getAttribute('aria-selected'), 'true');
    assert.equal(mounted.input.getAttribute('aria-activedescendant'), mounted.links[0].id);
    assert.equal(mounted.links[1].getAttribute(SEARCH_ACTIVE_ATTR), null);

    feature.destroy();
  });

  it('navigates options with ArrowDown and ArrowUp without moving keyboard focus out of the input', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 4 });
    const mounted = env.mountSearchDialog();
    const feature = createSearchDialogFeature({ doc: env.doc, observe: false });
    feature.init();

    const down1 = env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.input });
    assert.equal(down1.defaultPrevented, true);
    assert.equal(down1.propagationStopped, true);
    assert.equal(env.doc.activeElement, mounted.input, 'ArrowDown must not blur search input');
    assert.equal(mounted.links[0].getAttribute(SEARCH_ACTIVE_ATTR), null);
    assert.equal(mounted.links[1].getAttribute(SEARCH_ACTIVE_ATTR), 'true');
    assert.equal(mounted.input.getAttribute('aria-activedescendant'), mounted.links[1].id);

    const down2 = env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.input });
    assert.equal(down2.defaultPrevented, true);
    assert.equal(mounted.links[2].getAttribute(SEARCH_ACTIVE_ATTR), 'true');

    const up1 = env.dispatchKey('keydown', { key: 'ArrowUp', target: mounted.input });
    assert.equal(up1.defaultPrevented, true);
    assert.equal(env.doc.activeElement, mounted.input, 'ArrowUp must not blur search input');
    assert.equal(mounted.links[1].getAttribute(SEARCH_ACTIVE_ATTR), 'true');

    // Wrap around from index 0 on ArrowUp tap
    env.dispatchKey('keydown', { key: 'ArrowUp', target: mounted.input });
    assert.equal(mounted.links[0].getAttribute(SEARCH_ACTIVE_ATTR), 'true');
    env.dispatchKey('keydown', { key: 'ArrowUp', target: mounted.input });
    assert.equal(mounted.links[3].getAttribute(SEARCH_ACTIVE_ATTR), 'true');

    // Held repeat at bottom clamps instead of spinning back to top
    env.dispatchKey('keydown', { key: 'ArrowDown', repeat: true, target: mounted.input });
    assert.equal(mounted.links[3].getAttribute(SEARCH_ACTIVE_ATTR), 'true');

    // Fresh tap at bottom wraps cleanly to index 0
    env.dispatchKey('keydown', { key: 'ArrowDown', repeat: false, target: mounted.input });
    assert.equal(mounted.links[0].getAttribute(SEARCH_ACTIVE_ATTR), 'true');

    feature.destroy();
  });

  it('does not intercept typing, editing, ArrowLeft/Right, Home/End, modifiers, or IME composition', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 3 });
    const mounted = env.mountSearchDialog();
    const feature = createSearchDialogFeature({ doc: env.doc, observe: false });
    feature.init();

    for (const keyProps of [
      { key: 'a' },
      { key: 'Backspace' },
      { key: 'ArrowLeft' },
      { key: 'ArrowRight' },
      { key: 'Home' },
      { key: 'End' },
      { key: 'Escape' },
      { key: 'ArrowDown', shiftKey: true },
      { key: 'ArrowUp', ctrlKey: true },
      { key: 'ArrowDown', metaKey: true },
      { key: 'ArrowDown', altKey: true },
      { key: 'ArrowDown', isComposing: true },
      { key: 'Enter', isComposing: true },
      { key: 'k', ctrlKey: true },
    ]) {
      const ev = env.dispatchKey('keydown', { target: mounted.input, ...keyProps });
      assert.equal(ev.defaultPrevented, false, `should not intercept ${JSON.stringify(keyProps)}`);
    }

    assert.equal(mounted.links[0].getAttribute(SEARCH_ACTIVE_ATTR), 'true');
    assert.equal(env.doc.activeElement, mounted.input);
    feature.destroy();
  });

  it('activates the selected option on Enter while focused in the search input, but not when Clear/Close is focused', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 3 });
    const mounted = env.mountSearchDialog();
    const feature = createSearchDialogFeature({ doc: env.doc, observe: false });
    feature.init();

    env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.input });
    assert.equal(mounted.links[1].getAttribute(SEARCH_ACTIVE_ATTR), 'true');

    // If user tabbed to Close button, Enter must not click the search result
    env.doc.activeElement = mounted.closeBtn;
    const closeEnter = env.dispatchKey('keydown', { key: 'Enter', target: mounted.closeBtn });
    assert.equal(closeEnter.defaultPrevented, false);
    assert.equal(mounted.links[1].clickedCount, 0);

    // Back in search input, Enter activates the selected option
    env.doc.activeElement = mounted.input;
    const inputEnter = env.dispatchKey('keydown', { key: 'Enter', target: mounted.input });
    assert.equal(inputEnter.defaultPrevented, true);
    assert.equal(inputEnter.propagationStopped, true);
    assert.equal(mounted.links[1].clickedCount, 1);

    feature.destroy();
  });

  it('scrolls the viewport to keep the selected option visible on ArrowDown, ArrowUp, PageDown, and PageUp', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 10 });
    const mounted = env.mountSearchDialog({ rowHeight: 48, viewportHeight: 144 });
    const feature = createSearchDialogFeature({ doc: env.doc, observe: false });
    feature.init();

    // 3 rows fit in 144px viewport (0, 1, 2). Moving to index 3 should scroll down.
    env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.input });
    env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.input });
    env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.input });
    assert.equal(mounted.links[3].getAttribute(SEARCH_ACTIVE_ATTR), 'true');
    assert.ok(mounted.viewport.scrollTop > 0, `expected viewport to scroll down, got ${mounted.viewport.scrollTop}`);

    // PageDown jumps further down
    const beforePageDown = mounted.viewport.scrollTop;
    const pgDown = env.dispatchKey('keydown', { key: 'PageDown', target: mounted.input });
    assert.equal(pgDown.defaultPrevented, true);
    assert.ok(mounted.viewport.scrollTop > beforePageDown);

    // PageUp jumps back up
    const pgUp = env.dispatchKey('keydown', { key: 'PageUp', target: mounted.input });
    assert.equal(pgUp.defaultPrevented, true);
    assert.equal(env.doc.activeElement, mounted.input);

    feature.destroy();
  });

  it('resets selection to index 0 when search query updates results, but preserves selection when infinite scroll appends items', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 5 });
    const mounted = env.mountSearchDialog();
    const feature = createSearchDialogFeature({ doc: env.doc, observe: false });
    feature.init();

    // Move to index 2
    env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.input });
    env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.input });
    const thirdLink = mounted.links[2];
    assert.equal(thirdLink.getAttribute(SEARCH_ACTIVE_ATTR), 'true');

    // Infinite scroll appends more items while query is unchanged -> preserve selection!
    const extraLi = createFakeNode('li');
    const extraLink = createFakeNode('a', { attrs: { href: '/app/chat-6' }, textContent: 'Chat Title 6' });
    extraLi.appendChild(extraLink);
    mounted.ul.appendChild(extraLi);
    feature.sync();
    assert.equal(thirdLink.getAttribute(SEARCH_ACTIVE_ATTR), 'true', 'infinite scroll must preserve selection');

    // User types a query and results update -> reset selection to index 0!
    mounted.input.value = 'orbit';
    mounted.input.dispatchEvent(createFakeEvent('input'));
    const filteredLinks = mounted.populateItems(['Orbital mechanics', 'Orbit transfer']);
    feature.sync();
    assert.equal(filteredLinks[0].getAttribute(SEARCH_ACTIVE_ATTR), 'true');
    assert.equal(mounted.input.getAttribute('aria-activedescendant'), filteredLinks[0].id);
    assert.equal(env.doc.activeElement, mounted.input);

    feature.destroy();
  });

  it('syncs active selection on real mouse pointermove without stealing keyboard selection on stationary cursor', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 4 });
    const mounted = env.mountSearchDialog();
    const feature = createSearchDialogFeature({ doc: env.doc, observe: false });
    feature.init();

    // Moving mouse to link 2 highlights link 2 without blurring search input
    mounted.dialog.dispatchEvent(
      createFakeEvent('pointermove', { clientX: 400, clientY: 220, target: mounted.links[2] }),
    );
    assert.equal(mounted.links[2].getAttribute(SEARCH_ACTIVE_ATTR), 'true');
    assert.equal(env.doc.activeElement, mounted.input);

    // ArrowDown continues from link 2 -> link 3
    env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.input });
    assert.equal(mounted.links[3].getAttribute(SEARCH_ACTIVE_ATTR), 'true');

    // Stationary pointermove (same coordinates, e.g. from scroll) must NOT steal selection back to link 2
    mounted.dialog.dispatchEvent(
      createFakeEvent('pointermove', { clientX: 400, clientY: 220, target: mounted.links[2] }),
    );
    assert.equal(mounted.links[3].getAttribute(SEARCH_ACTIVE_ATTR), 'true');

    feature.destroy();
  });

  it('recovers smoothly if user clicks the scroll viewport and then presses ArrowDown', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 4 });
    const mounted = env.mountSearchDialog();
    const feature = createSearchDialogFeature({ doc: env.doc, observe: false });
    feature.init();

    env.doc.activeElement = mounted.viewport;
    const ev = env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.viewport });
    assert.equal(ev.defaultPrevented, true);
    assert.equal(mounted.links[1].getAttribute(SEARCH_ACTIVE_ATTR), 'true');
    assert.equal(env.doc.activeElement, mounted.input, 'focus should return to search input so user can keep typing');

    feature.destroy();
  });

  it('handles loading/error/empty states gracefully and cleans up on dialog close and destroy()', () => {
    const env = createFakeGeminiSearchEnv({ chatCount: 3 });
    const mounted = env.mountSearchDialog();
    const feature = createSearchDialogFeature({ doc: env.doc, observe: false });
    feature.init();

    // Error state: input disabled + alert replaces list
    mounted.input.disabled = true;
    mounted.ul.children.length = 0;
    const alertDiv = createFakeNode('div', { attrs: { role: 'alert' } });
    const retryBtn = createFakeNode('button', { attrs: { type: 'button' }, textContent: 'Try again' });
    alertDiv.appendChild(retryBtn);
    mounted.resultsSection.appendChild(alertDiv);
    feature.sync();

    assert.equal(mounted.input.getAttribute('aria-activedescendant'), null);
    const downDisabled = env.dispatchKey('keydown', { key: 'ArrowDown', target: mounted.input });
    assert.equal(downDisabled.defaultPrevented, false);

    // Dialog closes
    mounted.portal.remove();
    feature.sync();
    assert.equal(feature.getActiveOption(), null);

    feature.destroy();
  });
});
