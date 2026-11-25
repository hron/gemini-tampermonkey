import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_SCROLL_FEATURE_ID,
  createPageScrollFeature,
} from '../src/features/page-scroll.js';
import { computePageStep } from '../src/lib/scrolling.js';

function createFakeElement(
  tag,
  {
    attrs = {},
    classes = [],
    scrollTop = 0,
    clientHeight = 800,
    scrollHeight = 4000,
    overflowY = 'visible',
  } = {},
) {
  const children = [];
  const classSet = new Set(classes);
  const attrMap = new Map(Object.entries(attrs));

  const el = {
    tagName: tag.toUpperCase(),
    children,
    parentElement: null,
    scrollTop,
    clientHeight,
    scrollHeight,
    _overflowY: overflowY,
    scrollCalls: [],
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
    },
    getAttribute(k) {
      return attrMap.has(k) ? attrMap.get(k) : null;
    },
    matches(selector) {
      const parts = selector.split(',').map((s) => s.trim());
      for (const part of parts) {
        if (part === 'chat-window' && el.tagName === 'CHAT-WINDOW') return true;
        if (part === '[role="dialog"]' && attrMap.get('role') === 'dialog') return true;
        if (part === '[role="menu"]' && attrMap.get('role') === 'menu') return true;
        if (part === '[role="listbox"]' && attrMap.get('role') === 'listbox') return true;
        if (part === '[aria-modal="true"]' && attrMap.get('aria-modal') === 'true') return true;
        if (part === '.cdk-overlay-container' && classSet.has('cdk-overlay-container')) return true;
        if (
          part === 'button[data-gtm-feature="skip-to-previous-prompt"]' &&
          el.tagName === 'BUTTON' &&
          attrMap.get('data-gtm-feature') === 'skip-to-previous-prompt'
        ) {
          return true;
        }
        if (
          part === 'div.ql-editor[contenteditable="true"]' &&
          el.tagName === 'DIV' &&
          classSet.has('ql-editor') &&
          attrMap.get('contenteditable') === 'true'
        ) {
          return true;
        }
        if (part === 'rich-textarea [contenteditable="true"]' && attrMap.get('contenteditable') === 'true') {
          let p = el.parentElement;
          while (p) {
            if (p.tagName === 'RICH-TEXTAREA') return true;
            p = p.parentElement;
          }
        }
        if (
          part === '[role="textbox"][contenteditable="true"]' &&
          attrMap.get('role') === 'textbox' &&
          attrMap.get('contenteditable') === 'true'
        ) {
          return true;
        }
      }
      return false;
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (cur.matches && cur.matches(selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    appendChild(child) {
      child.parentElement = el;
      children.push(child);
      return child;
    },
    scrollBy({ top, behavior }) {
      el.scrollCalls.push({ method: 'scrollBy', top, behavior });
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + top));
    },
    scrollTo({ top, behavior }) {
      el.scrollCalls.push({ method: 'scrollTo', top, behavior });
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.max(0, Math.min(max, top));
    },
  };
  return el;
}

function createFakeEvent(type, props = {}) {
  return {
    type,
    key: '',
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

function createFakePageEnv({ initialScrollTop = 1500, clientHeight = 800, scrollHeight = 4000, withRaf = true } = {}) {
  const winListeners = new Map();
  const docListeners = new Map();
  const frames = new Map();
  let nowMs = 0;
  let nextId = 1;

  const body = createFakeElement('body');
  const chatWindow = createFakeElement('chat-window');
  const scroller = createFakeElement('infinite-scroller', {
    classes: ['chat-history'],
    attrs: { 'data-test-id': 'chat-history-container' },
    scrollTop: initialScrollTop,
    clientHeight,
    scrollHeight,
    overflowY: 'auto',
  });
  const richTextarea = createFakeElement('rich-textarea');
  const input = createFakeElement('div', {
    classes: ['ql-editor', 'textarea'],
    attrs: { contenteditable: 'true', role: 'textbox', 'aria-label': 'Enter a prompt for Gemini' },
  });
  const skipBtn = createFakeElement('button', {
    attrs: { 'data-gtm-feature': 'skip-to-previous-prompt' },
  });
  const editTextarea = createFakeElement('textarea');
  const dialog = createFakeElement('div', { attrs: { role: 'dialog' } });
  const dialogButton = createFakeElement('button');
  const sidebar = createFakeElement('bard-sidenav');
  const sidebarButton = createFakeElement('button');
  const scrollableCode = createFakeElement('pre', {
    clientHeight: 200,
    scrollHeight: 900,
    overflowY: 'auto',
  });

  richTextarea.appendChild(input);
  scroller.appendChild(editTextarea);
  scroller.appendChild(scrollableCode);
  chatWindow.appendChild(scroller);
  chatWindow.appendChild(richTextarea);
  chatWindow.appendChild(skipBtn);
  dialog.appendChild(dialogButton);
  sidebar.appendChild(sidebarButton);
  body.appendChild(chatWindow);
  body.appendChild(dialog);
  body.appendChild(sidebar);

  const defaultView = withRaf
    ? {
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
        requestAnimationFrame(cb) {
          const id = nextId++;
          frames.set(id, cb);
          return id;
        },
        cancelAnimationFrame(id) {
          frames.delete(id);
        },
        getComputedStyle(el) {
          return { overflowY: el._overflowY || 'visible' };
        },
      }
    : null;

  const doc = {
    activeElement: input,
    body,
    documentElement: createFakeElement('html'),
    defaultView,
    querySelector(sel) {
      if (sel.includes('chat-history-container')) return scroller;
      return null;
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

  for (const el of [
    body,
    chatWindow,
    scroller,
    richTextarea,
    input,
    skipBtn,
    editTextarea,
    dialog,
    dialogButton,
    sidebar,
    sidebarButton,
    scrollableCode,
  ]) {
    el.ownerDocument = doc;
  }

  const dispatchKey = (type, props) => {
    const ev = createFakeEvent(type, props);
    (defaultView || doc).dispatchEvent(ev);
    return ev;
  };

  const advanceMs = (totalMs, stepMs = 16.6667) => {
    const steps = Math.round(totalMs / stepMs);
    for (let i = 0; i < steps; i += 1) {
      if (frames.size === 0) break;
      nowMs += stepMs;
      const pending = Array.from(frames.entries());
      frames.clear();
      for (const [, cb] of pending) cb(nowMs);
    }
  };

  return {
    doc,
    body,
    chatWindow,
    scroller,
    input,
    skipBtn,
    editTextarea,
    dialogButton,
    sidebarButton,
    scrollableCode,
    frames,
    dispatchKey,
    advanceMs,
  };
}

describe('page-scroll feature', () => {
  it('smoothly scrolls chat history on PageUp and PageDown while prompt input stays focused', () => {
    const env = createFakePageEnv({ initialScrollTop: 1500, clientHeight: 800, scrollHeight: 4000 });
    const feature = createPageScrollFeature({ doc: env.doc });
    assert.equal(feature.id, PAGE_SCROLL_FEATURE_ID);
    feature.init();

    const pageStep = computePageStep(env.scroller);
    env.doc.activeElement = env.input;

    const upEv = env.dispatchKey('keydown', { key: 'PageUp', target: env.input });
    env.dispatchKey('keyup', { key: 'PageUp', target: env.input });
    assert.equal(upEv.defaultPrevented, true);
    assert.equal(upEv.propagationStopped, true);
    assert.equal(env.doc.activeElement, env.input, 'prompt input must stay focused');

    env.advanceMs(100);
    assert.ok(
      env.scroller.scrollTop < 1500 - 100 && env.scroller.scrollTop > 1500 - pageStep + 100,
      `PageUp should animate smoothly, got ${env.scroller.scrollTop}`,
    );

    env.advanceMs(700);
    assert.equal(env.scroller.scrollTop, 1500 - pageStep);
    assert.equal(env.frames.size, 0);

    const downEv = env.dispatchKey('keydown', { key: 'PageDown', target: env.input });
    env.dispatchKey('keyup', { key: 'PageDown', target: env.input });
    assert.equal(downEv.defaultPrevented, true);
    assert.equal(env.doc.activeElement, env.input);

    env.advanceMs(800);
    assert.equal(env.scroller.scrollTop, 1500);

    feature.destroy();
  });

  it('handles PageUp/PageDown when event target is a Text node inside the prompt input', () => {
    const env = createFakePageEnv({ initialScrollTop: 1200 });
    const feature = createPageScrollFeature({ doc: env.doc });
    feature.init();

    const textNode = { nodeType: 3, parentElement: env.input };
    env.doc.activeElement = env.input;
    const ev = env.dispatchKey('keydown', { key: 'PageUp', target: textNode });
    env.dispatchKey('keyup', { key: 'PageUp', target: textNode });
    assert.equal(ev.defaultPrevented, true);

    env.advanceMs(800);
    assert.equal(env.scroller.scrollTop, 1200 - computePageStep(env.scroller));

    feature.destroy();
  });

  it('ignores PageUp/PageDown with modifier keys (Shift, Ctrl, Alt, Meta) or IME composition', () => {
    const env = createFakePageEnv({ initialScrollTop: 1200 });
    const feature = createPageScrollFeature({ doc: env.doc });
    feature.init();

    for (const mods of [
      { shiftKey: true },
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { isComposing: true },
    ]) {
      const ev = env.dispatchKey('keydown', { key: 'PageUp', target: env.input, ...mods });
      assert.equal(ev.defaultPrevented, false);
    }

    assert.equal(env.frames.size, 0);
    assert.equal(env.scroller.scrollTop, 1200);

    feature.destroy();
  });

  it('does not hijack PageUp/PageDown in dialogs, sidebar, other textareas, skip button, or nested scrollable blocks', () => {
    const env = createFakePageEnv({ initialScrollTop: 1200 });
    const feature = createPageScrollFeature({ doc: env.doc });
    feature.init();

    for (const el of [
      env.skipBtn,
      env.editTextarea,
      env.dialogButton,
      env.sidebarButton,
      env.scrollableCode,
    ]) {
      env.doc.activeElement = el;
      const ev = env.dispatchKey('keydown', { key: 'PageUp', target: el });
      assert.equal(ev.defaultPrevented, false, `should not hijack PageUp on ${el.tagName}`);
    }

    assert.equal(env.scroller.scrollTop, 1200);
    feature.destroy();
  });

  it('smoothly scrolls chat when body is focused (e.g. after clicking in the chat)', () => {
    const env = createFakePageEnv({ initialScrollTop: 1200 });
    const feature = createPageScrollFeature({ doc: env.doc });
    feature.init();

    env.doc.activeElement = env.body;
    const ev = env.dispatchKey('keydown', { key: 'PageUp', target: env.body });
    env.dispatchKey('keyup', { key: 'PageUp', target: env.body });
    assert.equal(ev.defaultPrevented, true);

    env.advanceMs(800);
    assert.equal(env.scroller.scrollTop, 1200 - computePageStep(env.scroller));

    feature.destroy();
  });

  it('does not preventDefault when chat scroller has no scrollable overflow', () => {
    const env = createFakePageEnv({ initialScrollTop: 0, clientHeight: 800, scrollHeight: 800 });
    const feature = createPageScrollFeature({ doc: env.doc });
    feature.init();

    const ev = env.dispatchKey('keydown', { key: 'PageUp', target: env.input });
    assert.equal(ev.defaultPrevented, false);

    feature.destroy();
  });

  it('cleans up listeners and cancels in-flight animation on destroy()', () => {
    const env = createFakePageEnv({ initialScrollTop: 1500 });
    const feature = createPageScrollFeature({ doc: env.doc });
    feature.init();

    env.dispatchKey('keydown', { key: 'PageUp', target: env.input });
    env.advanceMs(50);
    assert.ok(env.frames.size > 0);

    feature.destroy();
    assert.equal(env.frames.size, 0);

    const ev = env.dispatchKey('keydown', { key: 'PageUp', target: env.input });
    assert.equal(ev.defaultPrevented, false);
  });
});
