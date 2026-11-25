// ==UserScript==
// @name         Gemini Keyboard Shortcuts
// @namespace    https://github.com/gemini-tampermonkey
// @version      0.1.1
// @description  Adds missing keyboard shortcuts to gemini.google.com, starting with Google AI Mode's "Skip to previous prompt" and keyboard output scrolling.
// @author       You
// @match        https://gemini.google.com/*
// @grant        GM_addStyle
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // --- src/lib/scrolling.js ---
  const ARROW_SCROLL_STEP_PX = 60;
  const ARROW_HOLD_SPEED_PX_PER_SEC = 750;
  const ARROW_HOLD_DELAY_SEC = 0.08;
  const ARROW_SPRING_OMEGA = 20;
  const PAGE_SCROLL_RATIO = 0.85;
  const MIN_PAGE_SCROLL_PX = 100;
  const PROMPT_SCROLL_PADDING_PX = 16;
  const PROMPT_SCROLL_TOLERANCE_PX = 12;

  const MAX_FRAME_DT_SEC = 0.05;
  const DEFAULT_FIRST_FRAME_DT_SEC = 1 / 60;
  const SETTLE_POSITION_EPSILON_PX = 0.5;
  const SETTLE_VELOCITY_EPSILON_PX_PER_SEC = 5;
  const EXTERNAL_SCROLL_TOLERANCE_PX = 2;

  /**
   * Translates a keyboard event on the skip control into a scroll action
   * for the chat history scroller, or null if the key is not a scroll key.
   */
  function computeScrollAction(event, scrollerMetrics) {
    if (!event || event.ctrlKey || event.altKey || event.metaKey) {
      return null;
    }

    const clientHeight = scrollerMetrics?.clientHeight || 600;
    const scrollHeight = scrollerMetrics?.scrollHeight || 0;
    const pageStep = Math.max(MIN_PAGE_SCROLL_PX, Math.round(clientHeight * PAGE_SCROLL_RATIO));
    const pageBehavior = event.repeat ? 'instant' : 'smooth';

    switch (event.key) {
      case 'ArrowUp':
        return { type: 'by', delta: -ARROW_SCROLL_STEP_PX, behavior: 'smooth' };
      case 'ArrowDown':
        return { type: 'by', delta: ARROW_SCROLL_STEP_PX, behavior: 'smooth' };
      case 'PageUp':
        return { type: 'by', delta: -pageStep, behavior: pageBehavior };
      case 'PageDown':
        return { type: 'by', delta: pageStep, behavior: pageBehavior };
      case 'Home':
        return { type: 'to', top: 0, behavior: pageBehavior };
      case 'End':
        return { type: 'to', top: scrollHeight, behavior: pageBehavior };
      default:
        return null;
    }
  }

  function toScrollOptions(scroller, opts) {
    const view = scroller?.ownerDocument?.defaultView;
    if (typeof cloneInto === 'function' && view) {
      try {
        return cloneInto(opts, view);
      } catch {
        return opts;
      }
    }
    return opts;
  }

  /**
   * Executes a computed scroll action on a scrollable element.
   */
  function applyScrollAction(scroller, action) {
    if (!scroller || !action) return false;

    if (action.type === 'by') {
      if (typeof scroller.scrollBy === 'function') {
        try {
          scroller.scrollBy(toScrollOptions(scroller, { top: action.delta, behavior: action.behavior }));
          return true;
        } catch {
          // Fallback when Firefox XrayWrapper rejects options dictionary
        }
      }
      scroller.scrollTop += action.delta;
      return true;
    }

    if (action.type === 'to') {
      if (typeof scroller.scrollTo === 'function') {
        try {
          scroller.scrollTo(toScrollOptions(scroller, { top: action.top, behavior: action.behavior }));
          return true;
        } catch {
          // Fallback when Firefox XrayWrapper rejects options dictionary
        }
      }
      scroller.scrollTop = action.top;
      return true;
    }

    return false;
  }

  /**
   * Given sorted prompt top offsets (in scroller content coordinates) and the
   * current scrollTop, returns the scrollTop target for the previous prompt
   * above the current viewport, or null if there are no prompts.
   */
  function findPreviousPromptScrollTop(
    promptOffsets,
    currentScrollTop,
    { paddingPx = PROMPT_SCROLL_PADDING_PX, tolerancePx = PROMPT_SCROLL_TOLERANCE_PX } = {},
  ) {
    if (!Array.isArray(promptOffsets) || promptOffsets.length === 0) {
      return null;
    }

    const threshold = currentScrollTop - tolerancePx;
    for (let i = promptOffsets.length - 1; i >= 0; i -= 1) {
      const targetTop = Math.max(0, Math.round(promptOffsets[i] - paddingPx));
      if (targetTop < threshold) {
        return targetTop;
      }
    }

    return Math.max(0, Math.round(promptOffsets[0] - paddingPx));
  }

  function setScrollTopInstant(scroller, top) {
    if (typeof scroller.scrollTo === 'function') {
      try {
        scroller.scrollTo(toScrollOptions(scroller, { top, behavior: 'instant' }));
        return;
      } catch {
        // Fallback when Firefox XrayWrapper rejects options dictionary
      }
    }
    scroller.scrollTop = top;
  }

  function getMaxScrollTop(scroller) {
    if (!scroller) return 0;
    const scrollHeight = scroller.scrollHeight || 0;
    const clientHeight = scroller.clientHeight || 0;
    return Math.max(0, scrollHeight - clientHeight);
  }

  function clampScrollTop(value, maxScroll) {
    return Math.max(0, Math.min(maxScroll, value));
  }

  /**
   * Drives continuous, frame-rate-independent smooth arrow scrolling via
   * requestAnimationFrame using a critically damped spring:
   * - Short taps smoothly glide by ARROW_SCROLL_STEP_PX without overshoot.
   * - Rapid taps accumulate seamlessly.
   * - Holding an arrow key transitions into continuous glide and coasts smoothly on release.
   */
  function createSmoothArrowScroller({
    getScroller,
    requestFrame = null,
    cancelFrame = null,
    prefersReducedMotion = null,
  } = {}) {
    const heldDirections = [];
    let activeScroller = null;
    let position = 0;
    let target = 0;
    let velocity = 0;
    let holdElapsed = 0;
    let lastAppliedScrollTop = null;
    let lastTimestamp = null;
    let rafId = null;

    function stop() {
      heldDirections.length = 0;
      holdElapsed = 0;
      velocity = 0;
      lastTimestamp = null;
      lastAppliedScrollTop = null;
      activeScroller = null;
      if (rafId !== null) {
        if (typeof cancelFrame === 'function') {
          cancelFrame(rafId);
        }
        rafId = null;
      }
    }

    function tick(timestamp) {
      rafId = null;

      const scroller = activeScroller || (typeof getScroller === 'function' ? getScroller() : null);
      if (!scroller) {
        stop();
        return;
      }

      const maxScroll = getMaxScrollTop(scroller);
      const currentDomScrollTop = scroller.scrollTop || 0;
      const heldDir = heldDirections.length > 0 ? heldDirections[heldDirections.length - 1] : 0;

      if (
        lastAppliedScrollTop !== null &&
        Math.abs(currentDomScrollTop - lastAppliedScrollTop) > EXTERNAL_SCROLL_TOLERANCE_PX
      ) {
        if (heldDir === 0) {
          stop();
          return;
        }
        position = currentDomScrollTop;
        target = clampScrollTop(position + heldDir * ARROW_SCROLL_STEP_PX, maxScroll);
        velocity = 0;
      }

      const dt =
        lastTimestamp === null
          ? DEFAULT_FIRST_FRAME_DT_SEC
          : Math.min(Math.max((timestamp - lastTimestamp) / 1000, 0), MAX_FRAME_DT_SEC);
      lastTimestamp = timestamp;

      if (heldDir !== 0) {
        holdElapsed += dt;
        if (holdElapsed > ARROW_HOLD_DELAY_SEC) {
          target = clampScrollTop(target + heldDir * ARROW_HOLD_SPEED_PX_PER_SEC * dt, maxScroll);
        } else {
          target = clampScrollTop(target, maxScroll);
        }
      } else {
        target = clampScrollTop(target, maxScroll);
      }

      // Exact analytical step for a critically damped spring (zero overshoot)
      const displacement = position - target;
      const decay = Math.exp(-ARROW_SPRING_OMEGA * dt);
      const c1 = displacement;
      const c2 = velocity + ARROW_SPRING_OMEGA * displacement;
      position = target + (c1 + c2 * dt) * decay;
      velocity = (c2 - ARROW_SPRING_OMEGA * (c1 + c2 * dt)) * decay;

      if (position <= 0 || (target === 0 && position < SETTLE_POSITION_EPSILON_PX)) {
        position = 0;
        if (velocity < 0 || target === 0) velocity = 0;
      } else if (
        position >= maxScroll ||
        (target === maxScroll && maxScroll - position < SETTLE_POSITION_EPSILON_PX)
      ) {
        position = maxScroll;
        if (velocity > 0 || target === maxScroll) velocity = 0;
      }

      if (
        heldDir === 0 &&
        Math.abs(target - position) < SETTLE_POSITION_EPSILON_PX &&
        Math.abs(velocity) < SETTLE_VELOCITY_EPSILON_PX_PER_SEC
      ) {
        position = target;
        velocity = 0;
        setScrollTopInstant(scroller, Math.round(position));
        stop();
        return;
      }

      if (Math.abs(position - currentDomScrollTop) >= 0.01) {
        setScrollTopInstant(scroller, position);
      }
      lastAppliedScrollTop = scroller.scrollTop || 0;

      rafId = requestFrame(tick);
    }

    function press(direction) {
      const scroller = typeof getScroller === 'function' ? getScroller() : null;
      if (!scroller || (direction !== -1 && direction !== 1)) {
        return false;
      }

      const reducedMotion = typeof prefersReducedMotion === 'function' && Boolean(prefersReducedMotion());
      if (typeof requestFrame !== 'function' || reducedMotion) {
        return applyScrollAction(scroller, {
          type: 'by',
          delta: direction * ARROW_SCROLL_STEP_PX,
          behavior: reducedMotion ? 'instant' : 'smooth',
        });
      }

      if (heldDirections.includes(direction)) {
        return true;
      }

      if (rafId === null || activeScroller !== scroller) {
        activeScroller = scroller;
        position = scroller.scrollTop || 0;
        target = position;
        velocity = 0;
        lastAppliedScrollTop = position;
        lastTimestamp = null;
      }

      heldDirections.push(direction);
      holdElapsed = 0;

      const maxScroll = getMaxScrollTop(scroller);
      if (Math.sign(target - position) !== direction) {
        target = position;
      }
      target = clampScrollTop(target + direction * ARROW_SCROLL_STEP_PX, maxScroll);

      if (rafId === null) {
        rafId = requestFrame(tick);
      }

      return true;
    }

    function release(direction) {
      const idx = heldDirections.indexOf(direction);
      if (idx === -1) return;
      heldDirections.splice(idx, 1);
      if (heldDirections.length > 0) {
        holdElapsed = 0;
      }
    }

    function isActive() {
      return rafId !== null;
    }

    return {
      press,
      release,
      stop,
      isActive,
    };
  }

  // --- src/lib/dom.js ---
  const PROMPT_INPUT_SELECTOR =
    'div.ql-editor[contenteditable="true"], rich-textarea [contenteditable="true"], [role="textbox"][contenteditable="true"]';

  const INPUT_ANCHOR_SELECTORS = [
    'div.input-area-container',
    'input-area-v2',
    'input-container',
  ];

  const CHAT_SCROLLER_SELECTORS = [
    'infinite-scroller[data-test-id="chat-history-container"]',
    'chat-window infinite-scroller.chat-history',
    'infinite-scroller.chat-history',
  ];

  const LEADING_ACTION_BUTTON_SELECTOR =
    '.leading-actions-wrapper button:not([disabled]), button[aria-label="Upload & tools"]:not([disabled])';

  function toPageOptions(obj, doc = document) {
    const view = doc?.defaultView;
    if (typeof cloneInto === 'function' && view) {
      try {
        return cloneInto(obj, view);
      } catch {
        return obj;
      }
    }
    return obj;
  }

  function findPromptInput(doc = document) {
    return doc.querySelector(PROMPT_INPUT_SELECTOR);
  }

  function isPromptInputElement(node) {
    if (!node) return false;
    const el = typeof node.closest === 'function' ? node : node.parentElement;
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(el.closest(PROMPT_INPUT_SELECTOR));
  }

  function findInputAnchor(doc = document) {
    for (const selector of INPUT_ANCHOR_SELECTORS) {
      const el = doc.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function findChatScroller(doc = document) {
    for (const selector of CHAT_SCROLLER_SELECTORS) {
      const el = doc.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function findLeadingActionButton(doc = document) {
    return doc.querySelector(LEADING_ACTION_BUTTON_SELECTOR);
  }

  function getPromptOffsetsInScroller(scroller) {
    if (!scroller || typeof scroller.querySelectorAll !== 'function') return [];
    const prompts = Array.from(scroller.querySelectorAll('user-query'));
    if (prompts.length === 0) return [];

    const scrollerTop = scroller.getBoundingClientRect().top;
    const scrollTop = scroller.scrollTop || 0;

    return prompts
      .map((el) => scrollTop + (el.getBoundingClientRect().top - scrollerTop))
      .sort((a, b) => a - b);
  }

  function injectStyles(css, styleId, doc = document) {
    if (typeof GM_addStyle === 'function') {
      try {
        const added = GM_addStyle(css);
        if (!added || added.sheet || !doc?.head) {
          return;
        }
      } catch {
        // Fall through to manual <style> injection
      }
    }
    if (!doc || typeof doc.querySelector !== 'function') return;
    if (doc.querySelector(`style[data-gtm-style-id="${styleId}"]`)) return;

    const styleEl = doc.createElement('style');
    styleEl.setAttribute('data-gtm-style-id', styleId);
    styleEl.textContent = css;
    const container = doc.head || doc.documentElement || doc.body;
    if (container && typeof container.appendChild === 'function') {
      container.appendChild(styleEl);
    }
  }

  // --- src/features/skip-to-previous-prompt.js ---
  const SKIP_FEATURE_ID = 'skip-to-previous-prompt';
  const SKIP_BUTTON_SELECTOR = `button[data-gtm-feature="${SKIP_FEATURE_ID}"]`;
  const SKIP_BUTTON_LABEL = 'Skip to previous prompt';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const SKIP_BUTTON_STYLES = `
  .gtm-skip-anchor {
    position: relative !important;
  }

  .gtm-skip-prev-prompt {
    position: absolute;
    right: 0;
    bottom: calc(100% + 10px);
    z-index: 1000;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px 8px 12px;
    border-radius: var(--gem-sys-shape--corner-full, 9999px);
    border: 1.5px solid transparent;
    background-color: var(--lumi-sys-color--surface-bright, #282a2c);
    color: var(--gem-sys-color--on-surface, #e3e3e3);
    font-family: "Google Sans", Roboto, Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: var(--lumi-sys-elevation--level2, 0 2px 10px rgba(0, 0, 0, 0.35));
    opacity: 0;
    pointer-events: none;
    transform: translateY(4px);
    transition: opacity 120ms ease, transform 120ms ease, background-color 120ms ease;
  }

  .gtm-skip-prev-prompt:focus,
  .gtm-skip-prev-prompt:focus-visible,
  .gtm-skip-prev-prompt.gtm-skip-prev-prompt--focused {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
    outline: 2px solid var(--gem-sys-color--primary, #8ab4f8);
    outline-offset: 1px;
    background-color: color-mix(
      in srgb,
      var(--gem-sys-color--primary, #8ab4f8) 16%,
      var(--lumi-sys-color--surface-bright, #282a2c)
    );
  }

  .gtm-skip-prev-prompt:hover {
    background-color: color-mix(
      in srgb,
      var(--gem-sys-color--primary, #8ab4f8) 24%,
      var(--lumi-sys-color--surface-bright, #282a2c)
    );
  }

  .gtm-skip-prev-prompt__icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    fill: currentColor;
  }

  @media (prefers-reduced-motion: reduce) {
    .gtm-skip-prev-prompt {
      transition: none;
    }
  }
  `;

  function createUpArrowIcon(doc) {
    if (typeof doc.createElementNS !== 'function') {
      const fallback = doc.createElement('span');
      fallback.setAttribute('aria-hidden', 'true');
      fallback.textContent = '↑';
      return fallback;
    }

    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'gtm-skip-prev-prompt__icon');

    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z');
    svg.appendChild(path);
    return svg;
  }

  function createSkipButton(doc) {
    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('tabindex', '-1');
    button.setAttribute('aria-label', SKIP_BUTTON_LABEL);
    button.setAttribute('data-gtm-feature', SKIP_FEATURE_ID);
    button.classList.add('gtm-skip-prev-prompt');

    button.appendChild(createUpArrowIcon(doc));

    const label = doc.createElement('span');
    label.textContent = SKIP_BUTTON_LABEL;
    button.appendChild(label);

    return button;
  }

  function createSkipToPreviousPromptFeature({ doc = document, observe = true } = {}) {
    let buttonEl = null;
    let observer = null;
    let syncScheduled = false;
    const view = doc.defaultView || null;
    const keyTarget = view || doc;

    const arrowScroller = createSmoothArrowScroller({
      getScroller: () => findChatScroller(doc),
      requestFrame:
        view && typeof view.requestAnimationFrame === 'function'
          ? (cb) => view.requestAnimationFrame(cb)
          : null,
      cancelFrame:
        view && typeof view.cancelAnimationFrame === 'function'
          ? (id) => view.cancelAnimationFrame(id)
          : null,
      prefersReducedMotion: () => {
        try {
          return Boolean(view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
        } catch {
          return false;
        }
      },
    });

    function focusElement(el) {
      if (!el || typeof el.focus !== 'function') return false;
      try {
        el.focus(toPageOptions({ preventScroll: true }, doc));
      } catch {
        el.focus();
      }
      return true;
    }

    function setButtonFocused(isFocused) {
      if (!buttonEl) return;
      if (isFocused) {
        buttonEl.classList.add('gtm-skip-prev-prompt--focused');
      } else {
        buttonEl.classList.remove('gtm-skip-prev-prompt--focused');
      }
    }

    function handleButtonFocus() {
      setButtonFocused(true);
    }

    function handleButtonBlur() {
      arrowScroller.stop();
      setButtonFocused(false);
    }

    function handleWindowBlur() {
      arrowScroller.stop();
    }

    function handleDocumentKeyUp(event) {
      if (event.key === 'ArrowUp') {
        arrowScroller.release(-1);
      } else if (event.key === 'ArrowDown') {
        arrowScroller.release(1);
      }
    }

    function handleDocumentFocusIn(event) {
      if (buttonEl && event.target !== buttonEl) {
        arrowScroller.stop();
        setButtonFocused(false);
      }
    }

    function skipToPreviousPrompt() {
      arrowScroller.stop();
      const scroller = findChatScroller(doc);
      if (!scroller) return false;

      const promptOffsets = getPromptOffsetsInScroller(scroller);
      const targetTop = findPreviousPromptScrollTop(promptOffsets, scroller.scrollTop || 0);
      if (targetTop === null) return false;

      return applyScrollAction(scroller, {
        type: 'to',
        top: targetTop,
        behavior: 'smooth',
      });
    }

    function handleButtonKeyDown(event) {
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        arrowScroller.stop();
        if (!event.shiftKey) {
          const input = findPromptInput(doc);
          if (input) {
            event.preventDefault();
            event.stopPropagation();
            setButtonFocused(false);
            focusElement(input);
          }
          return;
        }

        const leadingBtn = findLeadingActionButton(doc);
        if (leadingBtn) {
          event.preventDefault();
          event.stopPropagation();
          setButtonFocused(false);
          focusElement(leadingBtn);
        }
        return;
      }

      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        arrowScroller.stop();
        const input = findPromptInput(doc);
        if (input) {
          event.preventDefault();
          event.stopPropagation();
          setButtonFocused(false);
          focusElement(input);
        }
        return;
      }

      if (
        (event.key === 'Enter' || event.key === ' ') &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        skipToPreviousPrompt();
        return;
      }

      if (
        (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat || !arrowScroller.isActive()) {
          arrowScroller.press(direction);
        }
        return;
      }

      const scroller = findChatScroller(doc);
      const action = computeScrollAction(event, scroller);
      if (action) {
        arrowScroller.stop();
        event.preventDefault();
        event.stopPropagation();
        applyScrollAction(scroller, action);
      }
    }

    function handleButtonClick(event) {
      event.preventDefault();
      skipToPreviousPrompt();
    }

    function handleDocumentKeyDown(event) {
      if (
        event.key !== 'Tab' ||
        !event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        return;
      }

      if (!isPromptInputElement(doc.activeElement) && !isPromptInputElement(event.target)) {
        return;
      }

      const btn = sync();
      if (!btn) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      focusElement(btn);
      if (doc.activeElement === btn) {
        setButtonFocused(true);
      }
    }

    function sync() {
      const anchor = findInputAnchor(doc);
      if (!anchor) return null;

      anchor.classList.add('gtm-skip-anchor');

      const existing = doc.querySelector(SKIP_BUTTON_SELECTOR);
      if (existing && existing.parentElement === anchor) {
        buttonEl = existing;
        return buttonEl;
      }

      if (existing && existing !== buttonEl) {
        existing.remove();
      }

      if (!buttonEl) {
        buttonEl = createSkipButton(doc);
        buttonEl.addEventListener('keydown', handleButtonKeyDown);
        buttonEl.addEventListener('click', handleButtonClick);
        buttonEl.addEventListener('focus', handleButtonFocus);
        buttonEl.addEventListener('blur', handleButtonBlur);
      }

      const firstChild = anchor.children ? anchor.children[0] || null : null;
      if (typeof anchor.insertBefore === 'function' && firstChild) {
        anchor.insertBefore(buttonEl, firstChild);
      } else {
        anchor.appendChild(buttonEl);
      }

      return buttonEl;
    }

    function scheduleSync() {
      if (syncScheduled) return;
      syncScheduled = true;
      const run = () => {
        syncScheduled = false;
        sync();
      };
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(run);
      } else {
        setTimeout(run, 0);
      }
    }

    function init() {
      injectStyles(SKIP_BUTTON_STYLES, SKIP_FEATURE_ID, doc);
      keyTarget.addEventListener('keydown', handleDocumentKeyDown, true);
      keyTarget.addEventListener('keyup', handleDocumentKeyUp, true);
      keyTarget.addEventListener('blur', handleWindowBlur);
      doc.addEventListener('focusin', handleDocumentFocusIn, true);
      sync();

      const observeRoot = doc.body || doc.documentElement;
      if (observe && typeof MutationObserver === 'function' && observeRoot) {
        observer = new MutationObserver(scheduleSync);
        try {
          observer.observe(observeRoot, toPageOptions({ childList: true, subtree: true }, doc));
        } catch {
          observer.observe(observeRoot, { childList: true, subtree: true });
        }
      }
    }

    function destroy() {
      arrowScroller.stop();
      keyTarget.removeEventListener('keydown', handleDocumentKeyDown, true);
      keyTarget.removeEventListener('keyup', handleDocumentKeyUp, true);
      keyTarget.removeEventListener('blur', handleWindowBlur);
      doc.removeEventListener('focusin', handleDocumentFocusIn, true);
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (buttonEl) {
        buttonEl.removeEventListener('keydown', handleButtonKeyDown);
        buttonEl.removeEventListener('click', handleButtonClick);
        buttonEl.removeEventListener('focus', handleButtonFocus);
        buttonEl.removeEventListener('blur', handleButtonBlur);
        buttonEl.remove();
        buttonEl = null;
      }
    }

    return {
      id: SKIP_FEATURE_ID,
      init,
      sync,
      destroy,
    };
  }

  // --- src/main.js ---
  function bootstrapGeminiShortcuts(doc = document) {
    const features = [
      createSkipToPreviousPromptFeature({ doc, observe: true }),
    ];

    for (const feature of features) {
      feature.init();
    }

    return {
      features,
      destroy() {
        for (const feature of features) {
          feature.destroy();
        }
      },
    };
  }

  if (typeof document !== 'undefined') {
    bootstrapGeminiShortcuts(document);
  }
})();
