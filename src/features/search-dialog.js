import { injectStyles, toPageOptions } from '../lib/dom.js';

export const SEARCH_DIALOG_FEATURE_ID = 'search-dialog';
export const SEARCH_ACTIVE_ATTR = 'data-gtm-search-active';

const SEARCH_OPTION_ID_PREFIX = 'gtm-search-option-';
const SEARCH_DIALOG_OPTION_SELECTOR =
  'ul li a[href], ol li a[href], [role="listbox"] [role="option"], [role="option"], ul li button:not([disabled]), ol li button:not([disabled])';

const SEARCH_DIALOG_STYLES = `
[role="dialog"] [${SEARCH_ACTIVE_ATTR}="true"] {
  background-color: var(--lumi-sys-color-states--focus-on-surface, rgba(138, 180, 248, 0.16)) !important;
  background-color: color-mix(
    in srgb,
    var(--gem-sys-color--primary, #8ab4f8) 18%,
    var(--lumi-sys-color--surface-bright, #282a2c)
  ) !important;
  box-shadow: inset 0 0 0 1px color-mix(
    in srgb,
    var(--gem-sys-color--primary, #8ab4f8) 42%,
    transparent
  );
  border-radius: var(--gem-sys-shape--corner-full, 9999px);
}
`;

function resolveSearchElementNode(node) {
  if (!node) return null;
  if (typeof node.closest === 'function') return node;
  return node.parentElement && typeof node.parentElement.closest === 'function'
    ? node.parentElement
    : null;
}

function isSearchElementHidden(el, stopAt) {
  let cur = el;
  while (cur) {
    if (cur.hidden === true) return true;
    if (typeof cur.getAttribute === 'function') {
      if (cur.getAttribute('aria-hidden') === 'true') return true;
      if (cur.getAttribute('hidden') !== null) return true;
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
    if (cur === stopAt) break;
    cur = cur.parentElement;
  }
  return false;
}

export function findSearchDialog(doc = document) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;
  const dialogs = Array.from(doc.querySelectorAll('[role="dialog"]'));
  for (let i = dialogs.length - 1; i >= 0; i -= 1) {
    const dialog = dialogs[i];
    if (typeof dialog.hasAttribute === 'function' && dialog.hasAttribute('data-closed')) continue;
    if (isSearchElementHidden(dialog, dialog)) continue;

    const input =
      dialog.querySelector('[role="search"] input[type="search"]') ||
      dialog.querySelector('[role="search"] input:not([type="hidden"])') ||
      dialog.querySelector('input[type="search"]');

    if (input) {
      return { dialog, input };
    }
  }
  return null;
}

export function findSearchDialogOptions(dialog, input = null) {
  if (!dialog || typeof dialog.querySelectorAll !== 'function') return [];

  const candidates = Array.from(dialog.querySelectorAll(SEARCH_DIALOG_OPTION_SELECTOR));
  const seen = new Set();
  const options = [];

  for (const el of candidates) {
    if (!el || seen.has(el)) continue;
    if (el.disabled === true || (typeof el.getAttribute === 'function' && el.getAttribute('disabled') !== null)) {
      continue;
    }
    if (isSearchElementHidden(el, dialog)) continue;
    if (typeof el.closest === 'function' && el.closest('[role="alert"]')) continue;
    if (input && el === input) continue;

    // Skip secondary row buttons (e.g. a 3-dot menu) inside an <li> that already has a chat link
    if (el.tagName === 'BUTTON' && typeof el.closest === 'function') {
      const li = el.closest('li');
      if (li && typeof li.querySelector === 'function' && li.querySelector('a[href]')) {
        continue;
      }
    }

    seen.add(el);
    options.push(el);
  }

  return options;
}

export function computeNextOptionIndex(currentIndex, count, delta, { wrap = true } = {}) {
  if (count <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= count) {
    return delta < 0 ? count - 1 : 0;
  }
  const next = currentIndex + delta;
  if (wrap) {
    if (next < 0) return count - 1;
    if (next >= count) return 0;
    return next;
  }
  return Math.max(0, Math.min(count - 1, next));
}

function findSearchScrollViewport(option, dialog) {
  let cur = option?.parentElement || null;
  while (cur && cur !== dialog) {
    const dataId = typeof cur.getAttribute === 'function' ? cur.getAttribute('data-id') : null;
    const isMarkedViewport = Boolean(dataId && dataId.endsWith('-viewport'));

    if (
      typeof cur.scrollHeight === 'number' &&
      typeof cur.clientHeight === 'number' &&
      cur.scrollHeight > cur.clientHeight + 1
    ) {
      if (isMarkedViewport) return cur;
      const view = cur.ownerDocument?.defaultView;
      let overflowY = null;
      try {
        overflowY = view?.getComputedStyle?.(cur)?.overflowY || null;
      } catch {
        overflowY = null;
      }
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return cur;
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

function scrollSearchOptionIntoView(option, dialog, isFirst, doc) {
  if (!option) return;
  const viewport = findSearchScrollViewport(option, dialog);
  if (viewport) {
    if (isFirst) {
      viewport.scrollTop = 0;
      return;
    }
    if (
      typeof viewport.getBoundingClientRect === 'function' &&
      typeof option.getBoundingClientRect === 'function'
    ) {
      const vRect = viewport.getBoundingClientRect();
      const oRect = option.getBoundingClientRect();
      const pad = 4;
      const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      if (oRect.top < vRect.top + pad) {
        viewport.scrollTop = Math.max(0, viewport.scrollTop - (vRect.top + pad - oRect.top));
      } else if (oRect.bottom > vRect.bottom - pad) {
        viewport.scrollTop = Math.min(
          maxScroll,
          viewport.scrollTop + (oRect.bottom - (vRect.bottom - pad)),
        );
      }
      return;
    }
  }

  if (typeof option.scrollIntoView === 'function') {
    try {
      option.scrollIntoView(toPageOptions({ block: 'nearest' }, doc));
    } catch {
      option.scrollIntoView(false);
    }
  }
}

function computeSearchPageStepItems(options, viewport) {
  if (!viewport || options.length === 0) return 5;
  const firstRect =
    typeof options[0].getBoundingClientRect === 'function'
      ? options[0].getBoundingClientRect()
      : null;
  const rowHeight = firstRect && firstRect.height > 0 ? firstRect.height : 48;
  const viewportHeight =
    typeof viewport.clientHeight === 'number' && viewport.clientHeight > 0
      ? viewport.clientHeight
      : typeof viewport.getBoundingClientRect === 'function'
        ? viewport.getBoundingClientRect().height
        : 0;
  if (viewportHeight <= 0 || rowHeight <= 0) return 5;
  return Math.max(1, Math.floor(viewportHeight / rowHeight) - 1);
}

export function createSearchDialogFeature({ doc = document, observe = true } = {}) {
  let activeDialog = null;
  let activeInput = null;
  let activeOption = null;
  let lastQuery = '';
  let pendingQueryReset = false;
  let lastPointerX = null;
  let lastPointerY = null;
  let optionIdCounter = 0;
  let observer = null;
  let syncScheduled = false;

  const view = doc.defaultView || null;
  const keyTarget = view || doc;

  function focusSearchInput(inputEl) {
    if (!inputEl || typeof inputEl.focus !== 'function') return;
    try {
      inputEl.focus(toPageOptions({ preventScroll: true }, doc));
    } catch {
      inputEl.focus();
    }
  }

  function clearActiveOptionState(option, input) {
    if (option && typeof option.removeAttribute === 'function') {
      option.removeAttribute(SEARCH_ACTIVE_ATTR);
      option.removeAttribute('aria-selected');
    }
    if (input && typeof input.removeAttribute === 'function') {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function ensureOptionId(option) {
    if (option.id) return option.id;
    const existing = typeof option.getAttribute === 'function' ? option.getAttribute('id') : null;
    if (existing) return existing;
    optionIdCounter += 1;
    const generated = `${SEARCH_OPTION_ID_PREFIX}${optionIdCounter}`;
    if (typeof option.setAttribute === 'function') {
      option.setAttribute('id', generated);
    } else {
      option.id = generated;
    }
    return generated;
  }

  function setActiveOption(option, { scroll = false, isFirst = false } = {}) {
    if (activeOption && activeOption !== option) {
      clearActiveOptionState(activeOption, null);
    }

    activeOption = option || null;

    if (!activeOption) {
      if (activeInput && typeof activeInput.removeAttribute === 'function') {
        activeInput.removeAttribute('aria-activedescendant');
      }
      return;
    }

    const optId = ensureOptionId(activeOption);
    if (typeof activeOption.setAttribute === 'function') {
      activeOption.setAttribute(SEARCH_ACTIVE_ATTR, 'true');
      activeOption.setAttribute('aria-selected', 'true');
    }
    if (activeInput && typeof activeInput.setAttribute === 'function') {
      activeInput.setAttribute('aria-activedescendant', optId);
    }

    if (scroll) {
      scrollSearchOptionIntoView(activeOption, activeDialog, isFirst, doc);
    }
  }

  function handleInputChange() {
    if (!activeInput) return;
    lastQuery = activeInput.value || '';
    pendingQueryReset = true;
    scheduleSync();
  }

  function handleDialogPointerMove(event) {
    if (!activeDialog) return;
    if (
      typeof event.clientX === 'number' &&
      typeof event.clientY === 'number' &&
      event.clientX === lastPointerX &&
      event.clientY === lastPointerY
    ) {
      return;
    }
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    const targetEl = resolveSearchElementNode(event.target);
    if (!targetEl) return;

    const options = findSearchDialogOptions(activeDialog, activeInput);
    const hovered = options.find((opt) => opt === targetEl || (typeof opt.contains === 'function' && opt.contains(targetEl)));
    if (hovered && hovered !== activeOption) {
      setActiveOption(hovered, { scroll: false });
    }
  }

  function detachDialogListeners() {
    if (activeDialog && typeof activeDialog.removeEventListener === 'function') {
      activeDialog.removeEventListener('pointermove', handleDialogPointerMove, true);
    }
    if (activeInput && typeof activeInput.removeEventListener === 'function') {
      activeInput.removeEventListener('input', handleInputChange);
    }
    clearActiveOptionState(activeOption, activeInput);
    activeDialog = null;
    activeInput = null;
    activeOption = null;
    lastQuery = '';
    pendingQueryReset = false;
    lastPointerX = null;
    lastPointerY = null;
  }

  function sync() {
    const found = findSearchDialog(doc);
    if (!found) {
      if (activeDialog || activeInput || activeOption) {
        detachDialogListeners();
      }
      return null;
    }

    const isNewDialog = found.dialog !== activeDialog || found.input !== activeInput;
    if (isNewDialog) {
      detachDialogListeners();
      activeDialog = found.dialog;
      activeInput = found.input;
      lastQuery = activeInput.value || '';
      pendingQueryReset = false;

      if (typeof activeDialog.addEventListener === 'function') {
        activeDialog.addEventListener('pointermove', handleDialogPointerMove, true);
      }
      if (typeof activeInput.addEventListener === 'function') {
        activeInput.addEventListener('input', handleInputChange);
      }
    }

    if (activeInput.disabled) {
      setActiveOption(null);
      return activeDialog;
    }

    const options = findSearchDialogOptions(activeDialog, activeInput);
    if (options.length === 0) {
      setActiveOption(null);
      return activeDialog;
    }

    const currentQuery = activeInput.value || '';
    const queryChanged = pendingQueryReset || currentQuery !== lastQuery;
    lastQuery = currentQuery;
    pendingQueryReset = false;

    if (queryChanged) {
      setActiveOption(options[0], { scroll: true, isFirst: true });
      return activeDialog;
    }

    if (activeOption && options.includes(activeOption)) {
      setActiveOption(activeOption, { scroll: false });
      return activeDialog;
    }

    setActiveOption(options[0], { scroll: true, isFirst: true });
    return activeDialog;
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

  function isDialogOrViewportFocused(el) {
    if (!el || !activeDialog) return false;
    if (el === activeDialog) return true;
    if (typeof activeDialog.contains === 'function' && !activeDialog.contains(el)) {
      return false;
    }
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return false;
    }
    const dataId = typeof el.getAttribute === 'function' ? el.getAttribute('data-id') : null;
    if (dataId && dataId.endsWith('-viewport')) return true;
    return typeof el.getAttribute === 'function' && el.getAttribute('tabindex') === '0';
  }

  function handleKeyDown(event) {
    if (!event) return;
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'PageDown' &&
      event.key !== 'PageUp' &&
      event.key !== 'Enter'
    ) {
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.isComposing || event.keyCode === 229) return;

    if (!activeDialog || !activeInput) {
      sync();
    }
    if (!activeDialog || !activeInput || activeInput.disabled) return;

    const activeEl = resolveSearchElementNode(doc.activeElement);
    const targetEl = resolveSearchElementNode(event.target);

    const inputFocused = activeEl === activeInput || targetEl === activeInput;
    const viewportFocused = !inputFocused && isDialogOrViewportFocused(activeEl);

    if (event.key === 'Enter') {
      if (!inputFocused && !viewportFocused) return;
      const options = findSearchDialogOptions(activeDialog, activeInput);
      if (options.length === 0) return;

      const selected = activeOption && options.includes(activeOption) ? activeOption : options[0];
      if (!selected || typeof selected.click !== 'function') return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      selected.click();
      return;
    }

    if (!inputFocused && !viewportFocused) return;

    const options = findSearchDialogOptions(activeDialog, activeInput);
    if (options.length === 0) return;

    const currentIndex = activeOption ? options.indexOf(activeOption) : -1;
    let delta = 0;
    let wrap = !event.repeat;

    if (event.key === 'ArrowDown') {
      delta = 1;
    } else if (event.key === 'ArrowUp') {
      delta = -1;
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      const viewport = findSearchScrollViewport(options[0], activeDialog);
      const step = computeSearchPageStepItems(options, viewport);
      delta = event.key === 'PageDown' ? step : -step;
      wrap = false;
    }

    const nextIndex = computeNextOptionIndex(currentIndex, options.length, delta, { wrap });
    if (nextIndex < 0) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    if (viewportFocused) {
      focusSearchInput(activeInput);
    }

    setActiveOption(options[nextIndex], { scroll: true, isFirst: nextIndex === 0 });
  }

  function init() {
    injectStyles(SEARCH_DIALOG_STYLES, SEARCH_DIALOG_FEATURE_ID, doc);
    keyTarget.addEventListener('keydown', handleKeyDown, true);
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
    keyTarget.removeEventListener('keydown', handleKeyDown, true);
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    detachDialogListeners();
  }

  return {
    id: SEARCH_DIALOG_FEATURE_ID,
    init,
    sync,
    destroy,
    getActiveOption: () => activeOption,
  };
}
