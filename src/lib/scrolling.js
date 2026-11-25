export const ARROW_SCROLL_STEP_PX = 60;
export const PAGE_SCROLL_RATIO = 0.85;
export const MIN_PAGE_SCROLL_PX = 100;
export const PROMPT_SCROLL_PADDING_PX = 16;
export const PROMPT_SCROLL_TOLERANCE_PX = 12;

/**
 * Translates a keyboard event on the skip control into a scroll action
 * for the chat history scroller, or null if the key is not a scroll key.
 */
export function computeScrollAction(event, scrollerMetrics) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey) {
    return null;
  }

  const clientHeight = scrollerMetrics?.clientHeight || 600;
  const scrollHeight = scrollerMetrics?.scrollHeight || 0;
  const pageStep = Math.max(MIN_PAGE_SCROLL_PX, Math.round(clientHeight * PAGE_SCROLL_RATIO));
  const pageBehavior = event.repeat ? 'instant' : 'smooth';

  switch (event.key) {
    case 'ArrowUp':
      return { type: 'by', delta: -ARROW_SCROLL_STEP_PX, behavior: 'instant' };
    case 'ArrowDown':
      return { type: 'by', delta: ARROW_SCROLL_STEP_PX, behavior: 'instant' };
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
export function applyScrollAction(scroller, action) {
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
export function findPreviousPromptScrollTop(
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
