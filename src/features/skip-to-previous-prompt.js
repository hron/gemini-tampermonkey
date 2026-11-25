import {
  findChatScroller,
  findInputAnchor,
  findLeadingActionButton,
  findPromptInput,
  getPromptOffsetsInScroller,
  injectStyles,
  isPromptInputElement,
  toPageOptions,
} from '../lib/dom.js';
import {
  applyScrollAction,
  computeScrollAction,
  createSmoothArrowScroller,
  findPreviousPromptScrollTop,
} from '../lib/scrolling.js';

export const SKIP_FEATURE_ID = 'skip-to-previous-prompt';
export const SKIP_BUTTON_SELECTOR = `button[data-gtm-feature="${SKIP_FEATURE_ID}"]`;
export const SKIP_BUTTON_LABEL = 'Skip to previous prompt';

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

export function createSkipToPreviousPromptFeature({ doc = document, observe = true } = {}) {
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
