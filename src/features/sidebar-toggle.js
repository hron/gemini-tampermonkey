export const SIDEBAR_TOGGLE_FEATURE_ID = 'sidebar-toggle';

export const SIDEBAR_TOGGLE_SELECTORS = [
  // Live Gemini React Sidenav Island (swaps between close/open test IDs)
  'button[data-test-id="side-nav-close-button"]',
  'button[data-test-id="side-nav-open-button"]',
  '[data-test-id="side-nav-close-button"] button',
  '[data-test-id="side-nav-open-button"] button',
  '[data-test-id="side-nav-close-button"]',
  '[data-test-id="side-nav-open-button"]',
  // Angular / mobile Gemini shell
  'button[data-test-id="side-nav-menu-button"]',
  '[data-test-id="side-nav-menu-button"] button',
  '[data-test-id="side-nav-menu-button"]',
  'side-nav-menu-button button',
  'side-nav-sparkle-button button',
  'button.side-nav-menu-button',
  'button.bard-sidenav-toggle-button',
  // ARIA label fallbacks
  'button[aria-label="Close sidebar"]',
  'button[aria-label="Open sidebar"]',
  'button[aria-label="Main menu"]',
  'button[aria-label="Main Menu"]',
  'button[aria-label="Toggle navigation menu"]',
];

const SIDEBAR_TOGGLE_OVERLAY_SELECTOR =
  '[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"], .cdk-overlay-container';

function isSidebarToggleInOverlay(node) {
  if (!node) return false;
  const el = typeof node.closest === 'function' ? node : node.parentElement;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest(SIDEBAR_TOGGLE_OVERLAY_SELECTOR));
}

function isSidebarToggleDisabled(el) {
  if (!el) return true;
  if (el.disabled === true) return true;
  if (typeof el.getAttribute === 'function') {
    if (el.getAttribute('disabled') !== null) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
  }
  return false;
}

function isSidebarToggleHidden(el) {
  let cur = el;
  while (cur) {
    if (cur.hidden === true || cur.inert === true) return true;
    if (typeof cur.getAttribute === 'function') {
      if (cur.getAttribute('hidden') !== null) return true;
      if (cur.getAttribute('inert') !== null) return true;
      if (cur.getAttribute('aria-hidden') === 'true') return true;
    }
    const view = cur.ownerDocument?.defaultView;
    if (view && typeof view.getComputedStyle === 'function') {
      try {
        const style = view.getComputedStyle(cur);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) {
          return true;
        }
      } catch {
        // Ignore computed style errors on detached/mocked nodes
      }
    }
    cur = cur.parentElement;
  }

  if (typeof el.getBoundingClientRect === 'function') {
    try {
      const rect = el.getBoundingClientRect();
      if (rect && (rect.width <= 0 || rect.height <= 0)) {
        return true;
      }
      const view = el.ownerDocument?.defaultView;
      if (
        rect &&
        view &&
        typeof view.innerWidth === 'number' &&
        view.innerWidth > 0 &&
        (rect.right <= 0 || rect.left >= view.innerWidth)
      ) {
        return true;
      }
    } catch {
      // Ignore rect errors on mocked nodes
    }
  }

  return false;
}

export function findSidebarToggleButton(doc = document) {
  if (!doc) return null;

  for (const selector of SIDEBAR_TOGGLE_SELECTORS) {
    let candidates = [];
    if (typeof doc.querySelectorAll === 'function') {
      candidates = Array.from(doc.querySelectorAll(selector));
    } else if (typeof doc.querySelector === 'function') {
      const found = doc.querySelector(selector);
      if (found) candidates = [found];
    }

    for (const el of candidates) {
      if (!el || typeof el.click !== 'function') continue;
      if (isSidebarToggleDisabled(el)) continue;
      if (isSidebarToggleHidden(el)) continue;
      return el;
    }
  }

  return null;
}

export function isSidebarToggleShortcut(event) {
  if (
    !event ||
    !event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey ||
    event.isComposing ||
    event.keyCode === 229
  ) {
    return false;
  }
  if (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) {
    return false;
  }
  const key = typeof event.key === 'string' ? event.key : '';
  if (key.toLowerCase() === 'b') return true;
  if (/^[a-z]$/i.test(key)) return false;
  return event.code === 'KeyB';
}

export function createSidebarToggleFeature({ doc = document } = {}) {
  const view = doc.defaultView || null;
  const keyTarget = view || doc;

  function handleKeyDown(event) {
    if (!isSidebarToggleShortcut(event)) return;
    if (isSidebarToggleInOverlay(doc.activeElement) || isSidebarToggleInOverlay(event.target)) {
      return;
    }

    const toggleButton = findSidebarToggleButton(doc);
    if (!toggleButton) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    if (!event.repeat) {
      toggleButton.click();
    }
  }

  function init() {
    keyTarget.addEventListener('keydown', handleKeyDown, true);
  }

  function destroy() {
    keyTarget.removeEventListener('keydown', handleKeyDown, true);
  }

  return {
    id: SIDEBAR_TOGGLE_FEATURE_ID,
    init,
    destroy,
  };
}
