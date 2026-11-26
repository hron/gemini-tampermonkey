import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CITATION_CHIPS_FEATURE_ID,
  CITATION_CHIPS_STYLES,
  createCitationChipsFeature,
  findCitationChipButton,
  findSourceCardLink,
} from '../src/features/citation-chips.js';

function createFakeElement(tag, { attrs = {}, classes = [], disabled = false } = {}) {
  const children = [];
  const attrMap = new Map(Object.entries(attrs));
  const classSet = new Set(classes);

  const el = {
    tagName: tag.toUpperCase(),
    children,
    parentElement: null,
    ownerDocument: null,
    disabled,
    focusCalls: [],
    blurCount: 0,
    clickCount: 0,
    eventsLog: [],
    setAttribute(k, v) {
      attrMap.set(k, String(v));
      if (k === 'disabled') el.disabled = true;
    },
    getAttribute(k) {
      return attrMap.has(k) ? attrMap.get(k) : null;
    },
    removeAttribute(k) {
      attrMap.delete(k);
      if (k === 'disabled') el.disabled = false;
    },
    appendChild(child) {
      child.parentElement = el;
      if (el.ownerDocument) setOwnerDocDeep(child, el.ownerDocument);
      children.push(child);
      return child;
    },
    click() {
      el.clickCount += 1;
      el.eventsLog.push('click');
    },
    focus(opts) {
      el.focusCalls.push(opts);
      el.eventsLog.push('focus');
      if (el.ownerDocument) {
        el.ownerDocument.activeElement = el;
      }
    },
    blur() {
      el.blurCount += 1;
      el.eventsLog.push('blur');
      if (el.ownerDocument && el.ownerDocument.activeElement === el) {
        el.ownerDocument.activeElement = el.ownerDocument.body;
      }
    },
    matches(selector) {
      const parts = selector.split(',').map((s) => s.trim());
      return parts.some((part) => {
        if (part === 'source-inline-chip') {
          return el.tagName === 'SOURCE-INLINE-CHIP';
        }
        if (part === 'inline-source-card') {
          return el.tagName === 'INLINE-SOURCE-CARD';
        }
        if (part === '.cdk-overlay-popover') {
          return classSet.has('cdk-overlay-popover');
        }
        if (part === '.cdk-overlay-pane') {
          return classSet.has('cdk-overlay-pane');
        }
        if (part === '[role="dialog"]') {
          return attrMap.get('role') === 'dialog';
        }
        if (part === 'a[href]') {
          return el.tagName === 'A' && attrMap.has('href');
        }
        if (part === 'button') {
          return el.tagName === 'BUTTON';
        }
        if (part === 'source-inline-chip button') {
          if (el.tagName !== 'BUTTON') return false;
          let cur = el.parentElement;
          while (cur) {
            if (cur.tagName === 'SOURCE-INLINE-CHIP') return true;
            cur = cur.parentElement;
          }
          return false;
        }
        return false;
      });
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
      for (const child of el.children) {
        if (child.matches && child.matches(selector)) return child;
        const nested = child.querySelector ? child.querySelector(selector) : null;
        if (nested) return nested;
      }
      return null;
    },
    classList: {
      contains(name) {
        return classSet.has(name);
      },
    },
  };

  return el;
}

function setOwnerDocDeep(node, doc) {
  node.ownerDocument = doc;
  for (const child of node.children || []) {
    setOwnerDocDeep(child, doc);
  }
}

function createCitationChip(doc, { label = 'Google Antigravity', expanded = false, disabled = false } = {}) {
  const chip = createFakeElement('source-inline-chip');
  const container = createFakeElement('div', {
    classes: ['source-inline-chip-container', 'luminous-sources'],
  });
  const button = createFakeElement('button', {
    attrs: {
      cdkoverlayorigin: '',
      'aria-haspopup': 'dialog',
      'aria-expanded': expanded ? 'true' : 'false',
      ...(disabled ? { disabled: '' } : {}),
    },
    classes: ['button', 'multiple-button'],
    disabled,
  });
  const labelContainer = createFakeElement('div', { classes: ['source-label-container'] });
  const titleSpan = createFakeElement('span', { classes: ['source-title'] });
  const textNode = { nodeType: 3, textContent: label, parentElement: titleSpan };

  labelContainer.appendChild(titleSpan);
  button.appendChild(labelContainer);
  container.appendChild(button);
  chip.appendChild(container);
  doc.body.appendChild(chip);

  return { chip, container, button, labelContainer, titleSpan, textNode };
}

function createEnv() {
  const listeners = [];
  const head = createFakeElement('head');
  const body = createFakeElement('body');

  const defaultView = {
    addEventListener(type, fn, capture) {
      listeners.push({ target: 'window', type, fn, capture: Boolean(capture) });
    },
    removeEventListener(type, fn, capture) {
      const i = listeners.findIndex(
        (l) => l.target === 'window' && l.type === type && l.fn === fn && l.capture === Boolean(capture),
      );
      if (i >= 0) listeners.splice(i, 1);
    },
  };

  const doc = {
    defaultView,
    head,
    body,
    activeElement: body,
    createElement(tag) {
      const node = createFakeElement(tag);
      node.ownerDocument = doc;
      return node;
    },
    querySelector(sel) {
      const match = sel.match(/^style\[data-gtm-style-id="([^"]+)"\]$/);
      if (match) {
        return head.children.find((n) => n.getAttribute('data-gtm-style-id') === match[1]) || null;
      }
      return null;
    },
    addEventListener(type, fn, capture) {
      listeners.push({ target: 'document', type, fn, capture: Boolean(capture) });
    },
    removeEventListener(type, fn, capture) {
      const i = listeners.findIndex(
        (l) => l.target === 'document' && l.type === type && l.fn === fn && l.capture === Boolean(capture),
      );
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  setOwnerDocDeep(head, doc);
  setOwnerDocDeep(body, doc);

  const chip1 = createCitationChip(doc, { label: 'Zed' });
  const chip2 = createCitationChip(doc, { label: 'Google Antigravity + 2' });
  const disabledChip = createCitationChip(doc, { label: 'Disabled', disabled: true });

  // Standalone <a>-only chip without a <button> (should not be hijacked)
  const linkOnlyChip = createFakeElement('source-inline-chip');
  const linkOnlyAnchor = createFakeElement('a', { attrs: { href: 'https://example.com' } });
  linkOnlyChip.appendChild(linkOnlyAnchor);
  body.appendChild(linkOnlyChip);

  // Ordinary inline markdown link (<link-block><a>)
  const linkBlock = createFakeElement('link-block');
  const markdownLink = createFakeElement('a', {
    attrs: { href: 'https://doc.rust-lang.org/book/', externallink: '' },
  });
  linkBlock.appendChild(markdownLink);
  body.appendChild(linkBlock);

  // Source card inside opened popover mounted INSIDE <source-inline-chip> (mirrors live Gemini popover="manual" DOM)
  const popover = createFakeElement('div', {
    attrs: { popover: 'manual' },
    classes: ['cdk-overlay-popover', 'cdk-overlay-connected-position-bounding-box'],
  });
  const overlayPane = createFakeElement('div', { classes: ['cdk-overlay-pane'] });
  const dialog = createFakeElement('div', {
    attrs: { role: 'dialog', dialogkeyboardnav: '' },
    classes: ['hover-card-container', 'luminous'],
  });
  const sourceCard = createFakeElement('inline-source-card', { classes: ['luminous'] });
  const sourceCardWrapper = createFakeElement('div');
  const sourceCardLink = createFakeElement('a', {
    attrs: { href: 'https://zed.dev/acp/agent/antigravity-acp', target: '_blank' },
  });
  const sourceCardInner = createFakeElement('div', { classes: ['inline-source-card-container'] });
  sourceCardLink.appendChild(sourceCardInner);
  sourceCardWrapper.appendChild(sourceCardLink);
  sourceCard.appendChild(sourceCardWrapper);
  dialog.appendChild(sourceCard);
  overlayPane.appendChild(dialog);
  popover.appendChild(overlayPane);
  chip1.container.appendChild(popover);

  // Unrelated ordinary button
  const unrelatedButton = createFakeElement('button');
  body.appendChild(unrelatedButton);

  const fire = (target, props = {}, type = 'click') => {
    const ev = {
      type,
      target,
      isTrusted: false,
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
    for (const l of listeners.filter((x) => x.type === type)) {
      l.fn(ev);
    }
    return ev;
  };

  return {
    doc,
    head,
    listeners,
    chip1,
    chip2,
    disabledChip,
    linkOnlyAnchor,
    markdownLink,
    sourceCard,
    sourceCardWrapper,
    sourceCardLink,
    sourceCardInner,
    unrelatedButton,
    fire,
  };
}

describe('findCitationChipButton', () => {
  it('resolves the chip button from the button itself, nested descendants, text nodes, or chip container', () => {
    const env = createEnv();
    assert.equal(findCitationChipButton(env.chip1.button), env.chip1.button);
    assert.equal(findCitationChipButton(env.chip1.titleSpan), env.chip1.button);
    assert.equal(findCitationChipButton(env.chip1.textNode), env.chip1.button);
    assert.equal(findCitationChipButton(env.chip1.container), env.chip1.button);
    assert.equal(findCitationChipButton(env.chip1.chip), env.chip1.button);
  });

  it('returns null for disabled chips, link-only chips, ordinary links, and unrelated buttons', () => {
    const env = createEnv();
    assert.equal(findCitationChipButton(env.disabledChip.button), null);
    assert.equal(findCitationChipButton(env.linkOnlyAnchor), null);
    assert.equal(findCitationChipButton(env.markdownLink), null);
    assert.equal(findCitationChipButton(env.sourceCardLink), null);
    assert.equal(findCitationChipButton(env.unrelatedButton), null);
    assert.equal(findCitationChipButton(null), null);
  });
});

describe('citation-chips feature (Vimium compatibility)', () => {
  it('intercepts synthetic clicks on citation chips and focuses the chip button with preventScroll', () => {
    const env = createEnv();
    const feature = createCitationChipsFeature({ doc: env.doc });
    assert.equal(feature.id, CITATION_CHIPS_FEATURE_ID);
    feature.init();

    const ev = env.fire(env.chip1.titleSpan, { isTrusted: false });
    assert.equal(ev.defaultPrevented, true);
    assert.equal(ev.propagationStopped, true);
    assert.equal(ev.immediatePropagationStopped, true);
    assert.equal(env.doc.activeElement, env.chip1.button);
    assert.deepEqual(env.chip1.button.focusCalls, [{ preventScroll: true }]);
    assert.equal(env.chip1.button.blurCount, 0);

    // Also works when target is a Text node inside the chip
    const ev2 = env.fire(env.chip2.textNode, { isTrusted: false });
    assert.equal(ev2.defaultPrevented, true);
    assert.equal(env.doc.activeElement, env.chip2.button);
    assert.deepEqual(env.chip2.button.focusCalls, [{ preventScroll: true }]);

    feature.destroy();
  });

  it('blurs before refocusing when re-clicking an already-focused collapsed chip (post-Escape state)', () => {
    const env = createEnv();
    const feature = createCitationChipsFeature({ doc: env.doc });
    feature.init();

    // Simulate post-Escape state: chip1 is still focused, but its dialog is collapsed
    env.doc.activeElement = env.chip1.button;
    env.chip1.button.setAttribute('aria-expanded', 'false');

    const ev = env.fire(env.chip1.button, { isTrusted: false });
    assert.equal(ev.defaultPrevented, true);
    assert.deepEqual(env.chip1.button.eventsLog, ['blur', 'focus']);
    assert.equal(env.doc.activeElement, env.chip1.button);

    feature.destroy();
  });

  it('does not blur or flicker when clicking an already-focused and already-expanded chip', () => {
    const env = createEnv();
    const feature = createCitationChipsFeature({ doc: env.doc });
    feature.init();

    env.doc.activeElement = env.chip1.button;
    env.chip1.button.setAttribute('aria-expanded', 'true');

    const ev = env.fire(env.chip1.button, { isTrusted: false });
    assert.equal(ev.defaultPrevented, true);
    assert.deepEqual(env.chip1.button.eventsLog, []);
    assert.equal(env.doc.activeElement, env.chip1.button);

    feature.destroy();
  });

  it('focuses an expanded chip that was opened via mouse hover (not yet focused)', () => {
    const env = createEnv();
    const feature = createCitationChipsFeature({ doc: env.doc });
    feature.init();

    env.doc.activeElement = env.doc.body;
    env.chip1.button.setAttribute('aria-expanded', 'true');

    const ev = env.fire(env.chip1.button, { isTrusted: false });
    assert.equal(ev.defaultPrevented, true);
    assert.deepEqual(env.chip1.button.eventsLog, ['focus']);
    assert.equal(env.doc.activeElement, env.chip1.button);

    feature.destroy();
  });

  it('suppresses synthetic hover/unhover and pointer events on citation chips so Vimium clicks inside the popover stay connected', () => {
    const env = createEnv();
    const feature = createCitationChipsFeature({ doc: env.doc });
    feature.init();

    for (const type of [
      'pointerover',
      'mouseover',
      'pointerout',
      'mouseout',
      'pointerleave',
      'mouseleave',
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
    ]) {
      for (const target of [env.chip1.button, env.chip1.titleSpan, env.chip1.container]) {
        const synthEv = env.fire(target, { isTrusted: false }, type);
        assert.equal(synthEv.defaultPrevented, true, `synthetic ${type} on chip must be prevented`);
        assert.equal(synthEv.immediatePropagationStopped, true, `synthetic ${type} must stop propagation`);

        const trustedEv = env.fire(target, { isTrusted: true }, type);
        assert.equal(trustedEv.defaultPrevented, false, `trusted ${type} on chip must stay untouched`);
        assert.equal(trustedEv.propagationStopped, false);
      }

      for (const other of [env.markdownLink, env.sourceCardLink, env.unrelatedButton, env.linkOnlyAnchor]) {
        const otherEv = env.fire(other, { isTrusted: false }, type);
        assert.equal(otherEv.defaultPrevented, false, `synthetic ${type} on non-chip must stay untouched`);
      }
    }

    feature.destroy();
  });

  it('leaves real (trusted) clicks and non-chip synthetic clicks completely untouched', () => {
    const env = createEnv();
    const feature = createCitationChipsFeature({ doc: env.doc });
    feature.init();

    const trustedClick = env.fire(env.chip1.button, { isTrusted: true });
    assert.equal(trustedClick.defaultPrevented, false);
    assert.equal(trustedClick.propagationStopped, false);
    assert.equal(env.chip1.button.focusCalls.length, 0);

    for (const target of [
      env.markdownLink,
      env.sourceCardLink,
      env.unrelatedButton,
      env.linkOnlyAnchor,
      env.disabledChip.button,
    ]) {
      const ev = env.fire(target, { isTrusted: false });
      assert.equal(ev.defaultPrevented, false);
      assert.equal(ev.propagationStopped, false);
    }

    feature.destroy();
  });

  it('dispatches a fallback focus event only when button.focus() updates activeElement without emitting focus', () => {
    const env = createEnv();
    const feature = createCitationChipsFeature({ doc: env.doc });
    feature.init();

    // Case 1: browser emits native focus event -> must NOT dispatch a duplicate fallback event
    let nativeCount = 0;
    const chip1FocusListeners = [];
    env.chip1.button.addEventListener = (type, fn) => {
      if (type === 'focus') chip1FocusListeners.push(fn);
    };
    env.chip1.button.removeEventListener = (type, fn) => {
      const idx = chip1FocusListeners.indexOf(fn);
      if (type === 'focus' && idx >= 0) chip1FocusListeners.splice(idx, 1);
    };
    env.chip1.button.dispatchEvent = () => {
      nativeCount += 100;
      return true;
    };
    const origFocus1 = env.chip1.button.focus;
    env.chip1.button.focus = (opts) => {
      origFocus1(opts);
      nativeCount += 1;
      for (const fn of [...chip1FocusListeners]) fn({ type: 'focus' });
    };

    env.fire(env.chip1.button, { isTrusted: false });
    assert.equal(nativeCount, 1, 'must not double-fire focus when native focus event fired');

    // Case 2: unfocused window (focus() changes activeElement without firing focus event) -> dispatches fallback
    let fallbackEvents = [];
    const chip2FocusListeners = [];
    env.chip2.button.addEventListener = (type, fn) => {
      if (type === 'focus') chip2FocusListeners.push(fn);
    };
    env.chip2.button.removeEventListener = (type, fn) => {
      const idx = chip2FocusListeners.indexOf(fn);
      if (type === 'focus' && idx >= 0) chip2FocusListeners.splice(idx, 1);
    };
    env.chip2.button.dispatchEvent = (ev) => {
      fallbackEvents.push(ev.type);
      return true;
    };

    env.fire(env.chip2.button, { isTrusted: false });
    assert.deepEqual(fallbackEvents, ['focus'], 'must dispatch fallback focus event when browser suppressed it');

    feature.destroy();
  });

  it('injects CSS moving cursor:pointer from inline-source-card host onto its block-level anchor', () => {
    const env = createEnv();
    const feature = createCitationChipsFeature({ doc: env.doc });
    feature.init();

    assert.equal(env.head.children.length, 1);
    assert.equal(env.head.children[0].textContent, CITATION_CHIPS_STYLES);
    assert.match(CITATION_CHIPS_STYLES, /inline-source-card:not\(\.non-clickable\)\s*\{[^}]*cursor:\s*auto\s*!important/);
    assert.match(
      CITATION_CHIPS_STYLES,
      /inline-source-card:not\(\.non-clickable\)\s+a\[href\]\s*\{[^}]*display:\s*block\s*!important/,
    );
    assert.match(
      CITATION_CHIPS_STYLES,
      /inline-source-card:not\(\.non-clickable\)\s+a\[href\]\s*\{[^}]*cursor:\s*pointer\s*!important/,
    );

    feature.destroy();
  });

  it('forwards synthetic clicks on inline-source-card outside <a> to the inner a[href] without interfering with direct <a> clicks', () => {
    const env = createEnv();
    const feature = createCitationChipsFeature({ doc: env.doc });
    feature.init();

    assert.equal(findSourceCardLink(env.sourceCard), env.sourceCardLink);
    assert.equal(findSourceCardLink(env.sourceCardWrapper), env.sourceCardLink);
    assert.equal(findSourceCardLink(env.sourceCardLink), null);
    assert.equal(findSourceCardLink(env.sourceCardInner), null);

    // Synthetic click on <inline-source-card> host -> forwarded to a[href].click()
    const cardEv = env.fire(env.sourceCard, { isTrusted: false });
    assert.equal(cardEv.defaultPrevented, true);
    assert.equal(cardEv.immediatePropagationStopped, true);
    assert.equal(env.sourceCardLink.clickCount, 1);

    // Synthetic click on wrapper <div> above <a> -> forwarded to a[href].click()
    const wrapEv = env.fire(env.sourceCardWrapper, { isTrusted: false });
    assert.equal(wrapEv.defaultPrevented, true);
    assert.equal(env.sourceCardLink.clickCount, 2);

    // Real trusted click on <inline-source-card> -> untouched
    const trustedEv = env.fire(env.sourceCard, { isTrusted: true });
    assert.equal(trustedEv.defaultPrevented, false);
    assert.equal(env.sourceCardLink.clickCount, 2);

    // Synthetic click directly on <a> or its inner card container -> passes through natively
    const anchorEv = env.fire(env.sourceCardLink, { isTrusted: false });
    assert.equal(anchorEv.defaultPrevented, false);
    const innerEv = env.fire(env.sourceCardInner, { isTrusted: false });
    assert.equal(innerEv.defaultPrevented, false);
    assert.equal(env.sourceCardLink.clickCount, 2);

    feature.destroy();
  });

  it('removes all listeners on destroy()', () => {
    const env = createEnv();
    const feature = createCitationChipsFeature({ doc: env.doc });
    feature.init();
    assert.ok(env.listeners.length > 0);
    feature.destroy();
    assert.equal(env.listeners.length, 0);
  });
});
