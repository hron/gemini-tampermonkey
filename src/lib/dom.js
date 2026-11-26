export const PROMPT_INPUT_SELECTOR =
  'div.ql-editor[contenteditable="true"], rich-textarea [contenteditable="true"], [role="textbox"][contenteditable="true"]';

export const INPUT_ANCHOR_SELECTORS = [
  'div.input-area-container',
  'input-area-v2',
  'input-container',
];

export const CHAT_SCROLLER_SELECTORS = [
  'infinite-scroller[data-test-id="chat-history-container"]',
  'chat-window infinite-scroller.chat-history',
  'infinite-scroller.chat-history',
];

export const LEADING_ACTION_BUTTON_SELECTOR =
  '.leading-actions-wrapper button:not([disabled]), button[aria-label="Upload & tools"]:not([disabled])';

export function toPageOptions(obj, doc = document) {
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

export function focusElement(el, doc = document) {
  if (!el || typeof el.focus !== 'function') return false;
  try {
    el.focus(toPageOptions({ preventScroll: true }, doc));
  } catch {
    el.focus();
  }
  return true;
}

export function findPromptInput(doc = document) {
  return doc.querySelector(PROMPT_INPUT_SELECTOR);
}

export function isPromptInputElement(node) {
  if (!node) return false;
  const el = typeof node.closest === 'function' ? node : node.parentElement;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest(PROMPT_INPUT_SELECTOR));
}

export function findInputAnchor(doc = document) {
  for (const selector of INPUT_ANCHOR_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el) return el;
  }
  return null;
}

export function findChatScroller(doc = document) {
  for (const selector of CHAT_SCROLLER_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el) return el;
  }
  return null;
}

export function createDocumentScrollerOptions(doc = document) {
  const view = doc?.defaultView || null;
  return {
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
  };
}

export function findLeadingActionButton(doc = document) {
  return doc.querySelector(LEADING_ACTION_BUTTON_SELECTOR);
}

export function getPromptOffsetsInScroller(scroller) {
  if (!scroller || typeof scroller.querySelectorAll !== 'function') return [];
  const prompts = Array.from(scroller.querySelectorAll('user-query'));
  if (prompts.length === 0) return [];

  const scrollerTop = scroller.getBoundingClientRect().top;
  const scrollTop = scroller.scrollTop || 0;

  return prompts
    .map((el) => scrollTop + (el.getBoundingClientRect().top - scrollerTop))
    .sort((a, b) => a - b);
}

export function injectStyles(css, styleId, doc = document) {
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
