import { focusElement, injectStyles, toPageOptions } from '../lib/dom.js';

export const CITATION_CHIPS_FEATURE_ID = 'citation-chips';

const CITATION_CHIP_SELECTOR = 'source-inline-chip';
const CITATION_CHIP_BUTTON_SELECTOR = 'source-inline-chip button';
const CITATION_POPOVER_SELECTOR =
  '.cdk-overlay-popover, .cdk-overlay-pane, [role="dialog"], inline-source-card';
const SOURCE_CARD_SELECTOR = 'inline-source-card';
const CITATION_SYNTHETIC_POINTER_EVENTS = [
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
];

export const CITATION_CHIPS_STYLES = `
/* Gemini puts cursor: pointer on <inline-source-card> while leaving its inner
   <a> as display: inline wrapping a block card container. Because both share
   the exact same bounding box, Vimium hints <inline-source-card> instead of
   <a>, and its synthetic click bubbles upward without ever reaching <a>.
   Moving cursor: pointer onto a block-level <a> lets Vimium hint the link
   directly so f / F / yf work natively. */
inline-source-card:not(.non-clickable) {
  cursor: auto !important;
}

inline-source-card:not(.non-clickable) a[href] {
  display: block !important;
  cursor: pointer !important;
}
`;

function resolveCitationNode(node) {
  if (!node) return null;
  if (typeof node.closest === 'function') return node;
  return node.parentElement && typeof node.parentElement.closest === 'function'
    ? node.parentElement
    : null;
}

function isDisabledCitationButton(button) {
  if (!button) return true;
  if (button.disabled === true) return true;
  return typeof button.getAttribute === 'function' && button.getAttribute('disabled') !== null;
}

export function findCitationChipButton(target) {
  const el = resolveCitationNode(target);
  if (!el) return null;

  // Live Gemini mounts Angular CDK's <div popover="manual" class="cdk-overlay-popover">
  // INSIDE <source-inline-chip>. Never treat anything inside the opened popover as the
  // layer-1 citation chip button!
  if (el.closest(CITATION_POPOVER_SELECTOR)) return null;

  let button = el.closest(CITATION_CHIP_BUTTON_SELECTOR);
  if (!button) {
    const chip = el.closest(CITATION_CHIP_SELECTOR);
    button = chip && typeof chip.querySelector === 'function' ? chip.querySelector('button') : null;
  }

  if (!button || isDisabledCitationButton(button) || typeof button.focus !== 'function') {
    return null;
  }
  return button;
}

export function findSourceCardLink(target) {
  const el = resolveCitationNode(target);
  if (!el) return null;
  if (el.closest('a[href]')) return null;

  const card = el.closest(SOURCE_CARD_SELECTOR);
  if (!card || typeof card.querySelector !== 'function') return null;

  const link = card.querySelector('a[href]');
  return link && typeof link.click === 'function' ? link : null;
}

/**
 * Gemini renders inline citation chips (<source-inline-chip>) as <button>
 * elements whose sources popover opens on `focus` or `mouseenter`, not on
 * `click`, and tears down the popover on `mouseout`.
 *
 * Keyboard tools such as Vimium (`DomUtils.simulateClick`) dispatch synthetic
 * (untrusted) `mouseover` / `pointerdown` / `mousedown` / `pointerup` /
 * `mouseup` / `click` events without calling `focus()`, and also remember the
 * chip as `lastHoveredElement`. When the user then uses Vimium a second time to
 * click a source link inside the opened popover, Vimium's `mouseover` step
 * first dispatches a synthetic `mouseout` on `lastHoveredElement` (the chip),
 * which causes Gemini to tear down the popover and detach the target `<a>`
 * before `click` fires!
 *
 * Intercept only synthetic (non-trusted) hover/unhover, pointer, and click
 * events on citation chips so Gemini never sees Vimium's synthetic `mouseout`
 * or outside-pointer dismissal, then focus the chip button (blurring first if
 * it is already focused in a collapsed post-Escape state) to open or switch the
 * sources dialog. Real mouse interactions remain completely untouched.
 */
export function createCitationChipsFeature({ doc = document } = {}) {
  const view = doc.defaultView || null;
  const clickTarget = view || doc;

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function handleSyntheticPointer(event) {
    if (!event || event.isTrusted !== false) return;
    if (!findCitationChipButton(event.target)) return;
    stopEvent(event);
  }

  function handleClick(event) {
    if (!event || event.isTrusted !== false) return;
    const button = findCitationChipButton(event.target);
    if (!button) {
      const cardLink = findSourceCardLink(event.target);
      if (cardLink) {
        stopEvent(event);
        cardLink.click();
      }
      return;
    }

    stopEvent(event);

    const isExpanded =
      typeof button.getAttribute === 'function' && button.getAttribute('aria-expanded') === 'true';

    if (doc.activeElement === button && isExpanded) {
      return;
    }

    if (doc.activeElement === button && typeof button.blur === 'function') {
      button.blur();
    }

    let focusEventFired = false;
    const trackFocus = () => {
      focusEventFired = true;
    };
    const canListen = typeof button.addEventListener === 'function';
    if (canListen) {
      button.addEventListener('focus', trackFocus, true);
    }
    try {
      focusElement(button, doc);
    } finally {
      if (canListen && typeof button.removeEventListener === 'function') {
        button.removeEventListener('focus', trackFocus, true);
      }
    }

    // When the browser window lacks OS focus (e.g. DevTools focused or headless
    // Firefox), button.focus() moves activeElement without firing a focus event.
    if (
      canListen &&
      !focusEventFired &&
      doc.activeElement === button &&
      typeof button.dispatchEvent === 'function'
    ) {
      const FocusEventCtor =
        typeof FocusEvent === 'function'
          ? FocusEvent
          : view && typeof view.FocusEvent === 'function'
            ? view.FocusEvent
            : null;
      const EventCtor =
        typeof Event === 'function'
          ? Event
          : view && typeof view.Event === 'function'
            ? view.Event
            : null;
      try {
        if (FocusEventCtor) {
          button.dispatchEvent(new FocusEventCtor('focus', toPageOptions({ bubbles: false }, doc)));
        } else if (EventCtor) {
          button.dispatchEvent(new EventCtor('focus', toPageOptions({ bubbles: false }, doc)));
        }
      } catch {
        if (FocusEventCtor) {
          button.dispatchEvent(new FocusEventCtor('focus', { bubbles: false }));
        } else if (EventCtor) {
          button.dispatchEvent(new EventCtor('focus', { bubbles: false }));
        }
      }
    }
  }

  function init() {
    injectStyles(CITATION_CHIPS_STYLES, CITATION_CHIPS_FEATURE_ID, doc);
    for (const type of CITATION_SYNTHETIC_POINTER_EVENTS) {
      clickTarget.addEventListener(type, handleSyntheticPointer, true);
    }
    clickTarget.addEventListener('click', handleClick, true);
  }

  function destroy() {
    for (const type of CITATION_SYNTHETIC_POINTER_EVENTS) {
      clickTarget.removeEventListener(type, handleSyntheticPointer, true);
    }
    clickTarget.removeEventListener('click', handleClick, true);
  }

  return {
    id: CITATION_CHIPS_FEATURE_ID,
    init,
    destroy,
  };
}
