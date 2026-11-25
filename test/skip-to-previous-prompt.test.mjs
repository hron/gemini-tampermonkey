import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SKIP_BUTTON_SELECTOR,
  createSkipToPreviousPromptFeature,
} from '../src/features/skip-to-previous-prompt.js';

/**
 * Minimal DOM mock for testing keyboard focus transitions, button injection,
 * and scroll dispatch without requiring a real browser or third-party deps.
 */
function createFakeElement(tag, { attrs = {}, classes = [], rect = { top: 0 }, scrollTop = 0, clientHeight = 800, scrollHeight = 2400 } = {}) {
  const listeners = new Map();
  const children = [];
  const classSet = new Set(classes);
  const attrMap = new Map(Object.entries(attrs));

  const el = {
    tagName: tag.toUpperCase(),
    children,
    parentElement: null,
    style: {},
    innerHTML: '',
    textContent: '',
    scrollTop,
    clientHeight,
    scrollHeight,
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
      if (selector === SKIP_BUTTON_SELECTOR) {
        return attrMap.get('data-gtm-feature') === 'skip-to-previous-prompt';
      }
      if (selector.includes('ql-editor')) {
        return classSet.has('ql-editor') && attrMap.get('contenteditable') === 'true';
      }
      if (selector.includes('[contenteditable="true"]')) {
        return attrMap.get('contenteditable') === 'true';
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
    insertBefore(child, ref) {
      child.parentElement = el;
      const idx = ref ? children.indexOf(ref) : -1;
      if (idx === -1) children.push(child);
      else children.splice(idx, 0, child);
      return child;
    },
    remove() {
      if (!el.parentElement) return;
      const idx = el.parentElement.children.indexOf(el);
      if (idx >= 0) el.parentElement.children.splice(idx, 1);
      el.parentElement = null;
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
      event.target = event.target ?? el;
      const list = listeners.get(event.type) ?? [];
      for (const { fn } of list) fn(event);
      return !event.defaultPrevented;
    },
    getBoundingClientRect() {
      return { top: rect.top, bottom: rect.top + 40, left: 0, right: 200, width: 200, height: 40 };
    },
    scrollBy({ top, behavior }) {
      el.scrollCalls.push({ method: 'scrollBy', top, behavior });
      el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + top));
    },
    scrollTo({ top, behavior }) {
      el.scrollCalls.push({ method: 'scrollTo', top, behavior });
      el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, top));
    },
    focus() {
      if (el._doc) el._doc.activeElement = el;
      el.dispatchEvent(createFakeEvent('focus', { target: el }));
    },
    blur() {
      if (el._doc && el._doc.activeElement === el) el._doc.activeElement = el._doc.body;
      el.dispatchEvent(createFakeEvent('blur', { target: el }));
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
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    ...props,
  };
}

function createFakeGeminiEnv({ promptTops = [100, 700], initialScrollTop = 1000 } = {}) {
  const docListeners = new Map();
  const anchor = createFakeElement('div', { classes: ['input-area-container'] });
  const leadingBtn = createFakeElement('button', {
    attrs: { 'aria-label': 'Upload & tools' },
  });
  const input = createFakeElement('div', {
    classes: ['ql-editor', 'textarea'],
    attrs: { contenteditable: 'true', role: 'textbox', 'aria-label': 'Enter a prompt for Gemini' },
  });
  const scroller = createFakeElement('infinite-scroller', {
    classes: ['chat-history'],
    attrs: { 'data-test-id': 'chat-history-container' },
    rect: { top: 70 },
    scrollTop: initialScrollTop,
    clientHeight: 800,
    scrollHeight: 2400,
  });

  const prompts = promptTops.map((offsetTop) => {
    // Visual rect top = scroller.rect.top + (offsetTop - scroller.scrollTop)
    const p = createFakeElement('user-query');
    p.getBoundingClientRect = () => ({
      top: 70 + (offsetTop - scroller.scrollTop),
      bottom: 70 + (offsetTop - scroller.scrollTop) + 40,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
    });
    return p;
  });

  const doc = {
    activeElement: input,
    body: createFakeElement('body'),
    head: createFakeElement('head'),
    createElement(tag) {
      const el = createFakeElement(tag);
      el._doc = doc;
      return el;
    },
    querySelector(sel) {
      if (sel.includes('skip-to-previous-prompt')) {
        return anchor.children.find((c) => c.matches(SKIP_BUTTON_SELECTOR)) ?? null;
      }
      if (sel.includes('ql-editor')) return input;
      if (sel.includes('input-area-container')) return anchor;
      if (sel.includes('chat-history-container')) return scroller;
      if (sel.includes('leading-actions-wrapper')) return leadingBtn;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'user-query') return prompts;
      return [];
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

  scroller.querySelectorAll = (sel) => (sel === 'user-query' ? prompts : []);
  anchor._doc = doc;
  leadingBtn._doc = doc;
  input._doc = doc;
  scroller._doc = doc;

  return { doc, anchor, leadingBtn, input, scroller, prompts };
}

describe('skip-to-previous-prompt feature', () => {
  it('mounts the button inside the input anchor without duplicating on repeated syncs', () => {
    const env = createFakeGeminiEnv();
    const feature = createSkipToPreviousPromptFeature({ doc: env.doc, observe: false });
    feature.init();
    feature.sync();

    const buttons = env.anchor.children.filter((c) => c.matches(SKIP_BUTTON_SELECTOR));
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].getAttribute('aria-label'), 'Skip to previous prompt');
    assert.equal(buttons[0].getAttribute('tabindex'), '-1');
    assert.ok(env.anchor.classList.contains('gtm-skip-anchor'));

    feature.destroy();
  });

  it('moves focus from input field to Skip button on Shift+Tab, and back on Tab / Escape', () => {
    const env = createFakeGeminiEnv();
    const feature = createSkipToPreviousPromptFeature({ doc: env.doc, observe: false });
    feature.init();

    const btn = env.doc.querySelector(SKIP_BUTTON_SELECTOR);
    assert.ok(btn);

    // Shift+Tab from input -> focuses Skip button
    env.doc.activeElement = env.input;
    const shiftTabEvent = createFakeEvent('keydown', { key: 'Tab', shiftKey: true, target: env.input });
    env.doc.dispatchEvent(shiftTabEvent);
    assert.equal(shiftTabEvent.defaultPrevented, true);
    assert.equal(env.doc.activeElement, btn);

    // Tab from Skip button -> returns focus to input and clears focused class
    const tabBackEvent = createFakeEvent('keydown', { key: 'Tab', shiftKey: false, target: btn });
    btn.dispatchEvent(tabBackEvent);
    assert.equal(tabBackEvent.defaultPrevented, true);
    assert.equal(env.doc.activeElement, env.input);
    assert.equal(btn.classList.contains('gtm-skip-prev-prompt--focused'), false);

    // Shift+Tab again, then Escape -> returns focus to input and clears focused class
    env.doc.dispatchEvent(createFakeEvent('keydown', { key: 'Tab', shiftKey: true, target: env.input }));
    assert.equal(env.doc.activeElement, btn);
    assert.equal(btn.classList.contains('gtm-skip-prev-prompt--focused'), true);
    const escEvent = createFakeEvent('keydown', { key: 'Escape', target: btn });
    btn.dispatchEvent(escEvent);
    assert.equal(escEvent.defaultPrevented, true);
    assert.equal(env.doc.activeElement, env.input);
    assert.equal(btn.classList.contains('gtm-skip-prev-prompt--focused'), false);

    feature.destroy();
  });

  it('moves focus from Skip button to leading action button on second Shift+Tab (no focus trap)', () => {
    const env = createFakeGeminiEnv();
    const feature = createSkipToPreviousPromptFeature({ doc: env.doc, observe: false });
    feature.init();

    const btn = env.doc.querySelector(SKIP_BUTTON_SELECTOR);
    env.doc.activeElement = btn;

    const secondShiftTab = createFakeEvent('keydown', { key: 'Tab', shiftKey: true, target: btn });
    btn.dispatchEvent(secondShiftTab);

    assert.equal(secondShiftTab.defaultPrevented, true);
    assert.equal(env.doc.activeElement, env.leadingBtn);

    feature.destroy();
  });

  it('scrolls chat scroller on ArrowUp, ArrowDown, PageUp, PageDown, Home, and End while focused', () => {
    const env = createFakeGeminiEnv({ initialScrollTop: 1000 });
    const feature = createSkipToPreviousPromptFeature({ doc: env.doc, observe: false });
    feature.init();

    const btn = env.doc.querySelector(SKIP_BUTTON_SELECTOR);
    env.doc.activeElement = btn;

    for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
      const ev = createFakeEvent('keydown', { key, target: btn });
      btn.dispatchEvent(ev);
      assert.equal(ev.defaultPrevented, true, `${key} should call preventDefault`);
    }

    assert.equal(env.scroller.scrollCalls.length, 6);
    assert.equal(env.scroller.scrollCalls[0].method, 'scrollBy');
    assert.ok(env.scroller.scrollCalls[0].top < 0, 'ArrowUp scrolls up');
    assert.equal(env.scroller.scrollCalls[0].behavior, 'smooth', 'ArrowUp scrolls smoothly');
    assert.ok(env.scroller.scrollCalls[1].top > 0, 'ArrowDown scrolls down');
    assert.equal(env.scroller.scrollCalls[1].behavior, 'smooth', 'ArrowDown scrolls smoothly');
    assert.ok(env.scroller.scrollCalls[2].top < -100, 'PageUp scrolls up by page');
    assert.ok(env.scroller.scrollCalls[3].top > 100, 'PageDown scrolls down by page');
    assert.deepEqual(env.scroller.scrollCalls[4], { method: 'scrollTo', top: 0, behavior: 'smooth' });
    assert.deepEqual(env.scroller.scrollCalls[5], { method: 'scrollTo', top: 2400, behavior: 'smooth' });

    feature.destroy();
  });

  it('skips to previous user prompts sequentially on click / activation', () => {
    const env = createFakeGeminiEnv({ promptTops: [100, 700], initialScrollTop: 1200 });
    const feature = createSkipToPreviousPromptFeature({ doc: env.doc, observe: false });
    feature.init();

    const btn = env.doc.querySelector(SKIP_BUTTON_SELECTOR);

    btn.dispatchEvent(createFakeEvent('click', { target: btn }));
    assert.equal(env.scroller.scrollTop, 684);

    btn.dispatchEvent(createFakeEvent('click', { target: btn }));
    assert.equal(env.scroller.scrollTop, 84);

    feature.destroy();
  });

  it('skips to previous prompt directly on Enter and Space keydown (Firefox compatibility)', () => {
    const env = createFakeGeminiEnv({ promptTops: [100, 700], initialScrollTop: 1200 });
    const feature = createSkipToPreviousPromptFeature({ doc: env.doc, observe: false });
    feature.init();

    const btn = env.doc.querySelector(SKIP_BUTTON_SELECTOR);
    env.doc.activeElement = btn;

    const enterEvent = createFakeEvent('keydown', { key: 'Enter', target: btn });
    btn.dispatchEvent(enterEvent);
    assert.equal(enterEvent.defaultPrevented, true);
    assert.equal(env.scroller.scrollTop, 684);

    const spaceEvent = createFakeEvent('keydown', { key: ' ', target: btn });
    btn.dispatchEvent(spaceEvent);
    assert.equal(spaceEvent.defaultPrevented, true);
    assert.equal(env.scroller.scrollTop, 84);

    feature.destroy();
  });

  it('toggles explicit focused class on focus/blur and falls back if focus(options) throws', () => {
    const env = createFakeGeminiEnv();
    const feature = createSkipToPreviousPromptFeature({ doc: env.doc, observe: false });
    feature.init();

    const btn = env.doc.querySelector(SKIP_BUTTON_SELECTOR);
    let fallbackFocusCalled = false;
    const origFocus = btn.focus;
    btn.focus = (opts) => {
      if (opts && typeof opts === 'object') {
        throw new Error('Permission denied to access property "preventScroll"');
      }
      fallbackFocusCalled = true;
      origFocus();
    };

    env.doc.activeElement = env.input;
    env.doc.dispatchEvent(createFakeEvent('keydown', { key: 'Tab', shiftKey: true, target: env.input }));

    assert.equal(fallbackFocusCalled, true);
    assert.equal(env.doc.activeElement, btn);
    assert.equal(btn.classList.contains('gtm-skip-prev-prompt--focused'), true);

    btn.blur();
    assert.equal(btn.classList.contains('gtm-skip-prev-prompt--focused'), false);

    feature.destroy();
  });

  it('handles Shift+Tab when event target is a Text node inside contenteditable', () => {
    const env = createFakeGeminiEnv();
    const feature = createSkipToPreviousPromptFeature({ doc: env.doc, observe: false });
    feature.init();

    const textNode = { nodeType: 3, parentElement: env.input };
    env.doc.activeElement = env.doc.body;
    const ev = createFakeEvent('keydown', { key: 'Tab', shiftKey: true, target: textNode });
    env.doc.dispatchEvent(ev);

    assert.equal(ev.defaultPrevented, true);
    assert.equal(env.doc.activeElement, env.doc.querySelector(SKIP_BUTTON_SELECTOR));

    feature.destroy();
  });

  it('uses continuous requestAnimationFrame scrolling while ArrowDown is held and stops on keyup or blur', () => {
    const env = createFakeGeminiEnv({ initialScrollTop: 1000 });
    const winListeners = new Map();
    let nowMs = 0;
    let nextId = 1;
    const frames = new Map();

    env.doc.defaultView = {
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
    };

    const advanceMs = (totalMs) => {
      const steps = Math.round(totalMs / 16.6667);
      for (let i = 0; i < steps; i += 1) {
        if (frames.size === 0) break;
        nowMs += 16.6667;
        const pending = Array.from(frames.entries());
        frames.clear();
        for (const [, cb] of pending) cb(nowMs);
      }
    };

    const feature = createSkipToPreviousPromptFeature({ doc: env.doc, observe: false });
    feature.init();

    const btn = env.doc.querySelector(SKIP_BUTTON_SELECTOR);
    env.doc.activeElement = btn;

    // Initial keydown starts continuous motion
    const down1 = createFakeEvent('keydown', { key: 'ArrowDown', repeat: false, target: btn });
    btn.dispatchEvent(down1);
    assert.equal(down1.defaultPrevented, true);

    advanceMs(250);
    const posAfter250 = env.scroller.scrollTop;
    assert.ok(posAfter250 > 1100, `expected smooth continuous scroll, got ${posAfter250}`);

    // Repeat keydowns are prevented without triggering extra discrete scrollBy calls
    const repeatEv = createFakeEvent('keydown', { key: 'ArrowDown', repeat: true, target: btn });
    btn.dispatchEvent(repeatEv);
    assert.equal(repeatEv.defaultPrevented, true);
    assert.equal(env.scroller.scrollCalls.filter((c) => c.method === 'scrollBy').length, 0);

    // Keyup on window releases hold and coasts to a stop
    env.doc.defaultView.dispatchEvent(createFakeEvent('keyup', { key: 'ArrowDown' }));
    advanceMs(600);
    assert.equal(frames.size, 0);

    // Pressing PageUp cancels any in-flight arrow motion and smoothly glides up a page
    btn.dispatchEvent(createFakeEvent('keydown', { key: 'ArrowUp', repeat: false, target: btn }));
    advanceMs(50);
    assert.ok(frames.size > 0);
    const beforePageUp = env.scroller.scrollTop;
    btn.dispatchEvent(createFakeEvent('keydown', { key: 'PageUp', repeat: false, target: btn }));
    env.doc.defaultView.dispatchEvent(createFakeEvent('keyup', { key: 'PageUp' }));
    assert.equal(frames.size, 1, 'should replace arrow rAF with smooth page-scroll rAF');
    advanceMs(700);
    assert.equal(frames.size, 0, 'smooth page scroll should settle cleanly');
    assert.ok(
      env.scroller.scrollTop < beforePageUp - 600,
      `PageUp should smoothly scroll up a full page from ${beforePageUp}, got ${env.scroller.scrollTop}`,
    );

    // Pressing Home cancels any in-flight smooth motion cleanly
    btn.dispatchEvent(createFakeEvent('keydown', { key: 'ArrowDown', repeat: false, target: btn }));
    advanceMs(50);
    assert.ok(frames.size > 0);
    btn.dispatchEvent(createFakeEvent('keydown', { key: 'Home', repeat: false, target: btn }));
    assert.equal(frames.size, 0);

    feature.destroy();
  });
});
