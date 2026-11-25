export const ARROW_SCROLL_STEP_PX = 60;
export const ARROW_HOLD_SPEED_PX_PER_SEC = 750;
export const ARROW_HOLD_DELAY_SEC = 0.08;
export const ARROW_SPRING_OMEGA = 20;
export const PAGE_SCROLL_RATIO = 0.85;
export const MIN_PAGE_SCROLL_PX = 100;
export const PROMPT_SCROLL_PADDING_PX = 16;
export const PROMPT_SCROLL_TOLERANCE_PX = 12;

const MAX_FRAME_DT_SEC = 0.05;
const DEFAULT_FIRST_FRAME_DT_SEC = 1 / 60;
const SETTLE_POSITION_EPSILON_PX = 0.5;
const SETTLE_VELOCITY_EPSILON_PX_PER_SEC = 5;
const EXTERNAL_SCROLL_TOLERANCE_PX = 2;

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
export function createSmoothArrowScroller({
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
