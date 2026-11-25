import {
  createDocumentScrollerOptions,
  findChatScroller,
  isPromptInputElement,
} from '../lib/dom.js';
import { createSmoothPageScroller } from '../lib/scrolling.js';

export const PAGE_SCROLL_FEATURE_ID = 'page-scroll';

const OVERLAY_SELECTOR =
  '[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"], .cdk-overlay-container';
const SKIP_CONTROL_SELECTOR = 'button[data-gtm-feature="skip-to-previous-prompt"]';
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function getElementNode(node) {
  if (!node) return null;
  if (typeof node.closest === 'function') return node;
  return node.parentElement && typeof node.parentElement.closest === 'function'
    ? node.parentElement
    : null;
}

function isInsideOverlay(el) {
  return Boolean(el && el.closest(OVERLAY_SELECTOR));
}

function isEditableOrFormControl(el) {
  if (!el) return false;
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable === true) return true;
  if (typeof el.getAttribute === 'function') {
    const ce = el.getAttribute('contenteditable');
    if (ce === 'true' || ce === '') return true;
    if (el.getAttribute('role') === 'textbox') return true;
  }
  return false;
}

function hasNestedVerticalScroller(el, chatScroller) {
  let cur = el;
  while (cur && cur !== chatScroller) {
    if (
      typeof cur.scrollHeight === 'number' &&
      typeof cur.clientHeight === 'number' &&
      cur.scrollHeight > cur.clientHeight + 1
    ) {
      const view = cur.ownerDocument?.defaultView;
      let overflowY = null;
      try {
        overflowY = view?.getComputedStyle?.(cur)?.overflowY || null;
      } catch {
        overflowY = null;
      }
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return true;
      }
    }
    cur = cur.parentElement;
  }
  return false;
}

function shouldHandlePageScroll(event, doc, scroller) {
  if (!event || (event.key !== 'PageUp' && event.key !== 'PageDown')) {
    return false;
  }
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing) {
    return false;
  }
  if (!scroller) return false;
  if (
    typeof scroller.scrollHeight === 'number' &&
    typeof scroller.clientHeight === 'number' &&
    scroller.scrollHeight <= scroller.clientHeight
  ) {
    return false;
  }

  const activeEl = getElementNode(doc.activeElement);
  const targetEl = getElementNode(event.target);

  if (
    activeEl?.closest(SKIP_CONTROL_SELECTOR) ||
    targetEl?.closest(SKIP_CONTROL_SELECTOR)
  ) {
    return false;
  }

  if (isInsideOverlay(activeEl) || isInsideOverlay(targetEl)) {
    return false;
  }

  if (isPromptInputElement(activeEl) || isPromptInputElement(targetEl)) {
    return true;
  }

  if (isEditableOrFormControl(activeEl) || isEditableOrFormControl(targetEl)) {
    return false;
  }

  if (
    hasNestedVerticalScroller(activeEl, scroller) ||
    hasNestedVerticalScroller(targetEl, scroller)
  ) {
    return false;
  }

  if (!activeEl || activeEl === doc.body || activeEl === doc.documentElement) {
    return true;
  }

  return Boolean(activeEl.closest('chat-window') || activeEl === scroller);
}

export function createPageScrollFeature({ doc = document } = {}) {
  const view = doc.defaultView || null;
  const keyTarget = view || doc;
  const pageScroller = createSmoothPageScroller(createDocumentScrollerOptions(doc));

  function handleKeyDown(event) {
    const scroller = findChatScroller(doc);
    if (!shouldHandlePageScroll(event, doc, scroller)) {
      if (pageScroller.isActive()) {
        const activeEl = getElementNode(doc.activeElement);
        const targetEl = getElementNode(event?.target);
        if (
          activeEl?.closest(SKIP_CONTROL_SELECTOR) ||
          targetEl?.closest(SKIP_CONTROL_SELECTOR)
        ) {
          pageScroller.stop();
        }
      }
      return;
    }

    const direction = event.key === 'PageUp' ? -1 : 1;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    if (!event.repeat || !pageScroller.isActive()) {
      pageScroller.press(direction);
    }
  }

  function handleKeyUp(event) {
    if (event.key === 'PageUp') {
      pageScroller.release(-1);
    } else if (event.key === 'PageDown') {
      pageScroller.release(1);
    }
  }

  function handleWindowBlur() {
    pageScroller.stop();
  }

  function init() {
    keyTarget.addEventListener('keydown', handleKeyDown, true);
    keyTarget.addEventListener('keyup', handleKeyUp, true);
    keyTarget.addEventListener('blur', handleWindowBlur);
  }

  function destroy() {
    pageScroller.stop();
    keyTarget.removeEventListener('keydown', handleKeyDown, true);
    keyTarget.removeEventListener('keyup', handleKeyUp, true);
    keyTarget.removeEventListener('blur', handleWindowBlur);
  }

  return {
    id: PAGE_SCROLL_FEATURE_ID,
    init,
    destroy,
  };
}
