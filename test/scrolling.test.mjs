import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARROW_SCROLL_STEP_PX,
  PAGE_SCROLL_RATIO,
  computeScrollAction,
  findPreviousPromptScrollTop,
  applyScrollAction,
  createSmoothArrowScroller,
} from '../src/lib/scrolling.js';

describe('computeScrollAction', () => {
  const metrics = {
    clientHeight: 800,
    scrollHeight: 3200,
    scrollTop: 1000,
  };

  it('scrolls up smoothly by ARROW_SCROLL_STEP_PX on ArrowUp', () => {
    const action = computeScrollAction({ key: 'ArrowUp' }, metrics);
    assert.deepEqual(action, {
      type: 'by',
      delta: -ARROW_SCROLL_STEP_PX,
      behavior: 'smooth',
    });
  });

  it('scrolls down smoothly by ARROW_SCROLL_STEP_PX on ArrowDown', () => {
    const action = computeScrollAction({ key: 'ArrowDown' }, metrics);
    assert.deepEqual(action, {
      type: 'by',
      delta: ARROW_SCROLL_STEP_PX,
      behavior: 'smooth',
    });
  });

  it('keeps smooth scrolling when ArrowUp or ArrowDown is held (repeat)', () => {
    assert.deepEqual(computeScrollAction({ key: 'ArrowUp', repeat: true }, metrics), {
      type: 'by',
      delta: -ARROW_SCROLL_STEP_PX,
      behavior: 'smooth',
    });
    assert.deepEqual(computeScrollAction({ key: 'ArrowDown', repeat: true }, metrics), {
      type: 'by',
      delta: ARROW_SCROLL_STEP_PX,
      behavior: 'smooth',
    });
  });

  it('scrolls up by ~85% of viewport height smoothly on PageUp', () => {
    const action = computeScrollAction({ key: 'PageUp', repeat: false }, metrics);
    assert.deepEqual(action, {
      type: 'by',
      delta: -Math.round(800 * PAGE_SCROLL_RATIO),
      behavior: 'smooth',
    });
  });

  it('scrolls down instantly when PageDown is held (repeat)', () => {
    const action = computeScrollAction({ key: 'PageDown', repeat: true }, metrics);
    assert.deepEqual(action, {
      type: 'by',
      delta: Math.round(800 * PAGE_SCROLL_RATIO),
      behavior: 'instant',
    });
  });

  it('scrolls to top on Home and bottom on End', () => {
    assert.deepEqual(computeScrollAction({ key: 'Home', repeat: false }, metrics), {
      type: 'to',
      top: 0,
      behavior: 'smooth',
    });
    assert.deepEqual(computeScrollAction({ key: 'End', repeat: false }, metrics), {
      type: 'to',
      top: 3200,
      behavior: 'smooth',
    });
  });

  it('ignores keys with modifier keys pressed', () => {
    assert.equal(computeScrollAction({ key: 'ArrowUp', ctrlKey: true }, metrics), null);
    assert.equal(computeScrollAction({ key: 'PageDown', altKey: true }, metrics), null);
    assert.equal(computeScrollAction({ key: 'ArrowDown', metaKey: true }, metrics), null);
  });

  it('returns null for unrelated keys', () => {
    assert.equal(computeScrollAction({ key: 'Enter' }, metrics), null);
    assert.equal(computeScrollAction({ key: 'a' }, metrics), null);
  });
});

describe('applyScrollAction', () => {
  it('calls scrollBy for "by" actions and scrollTo for "to" actions', () => {
    const calls = [];
    const scroller = {
      scrollBy(opts) {
        calls.push(['scrollBy', opts]);
      },
      scrollTo(opts) {
        calls.push(['scrollTo', opts]);
      },
    };

    applyScrollAction(scroller, { type: 'by', delta: -60, behavior: 'instant' });
    applyScrollAction(scroller, { type: 'to', top: 0, behavior: 'smooth' });

    assert.deepEqual(calls, [
      ['scrollBy', { top: -60, behavior: 'instant' }],
      ['scrollTo', { top: 0, behavior: 'smooth' }],
    ]);
  });

  it('falls back to direct scrollTop assignment if scrollBy/scrollTo throws (Firefox XrayWrapper)', () => {
    const scroller = {
      scrollTop: 200,
      scrollBy() {
        throw new Error('Permission denied to access property "top"');
      },
      scrollTo() {
        throw new Error('Permission denied to access property "behavior"');
      },
    };

    assert.equal(applyScrollAction(scroller, { type: 'by', delta: -60, behavior: 'instant' }), true);
    assert.equal(scroller.scrollTop, 140);

    assert.equal(applyScrollAction(scroller, { type: 'to', top: 0, behavior: 'smooth' }), true);
    assert.equal(scroller.scrollTop, 0);
  });
});

describe('findPreviousPromptScrollTop', () => {
  it('returns null when there are no prompts', () => {
    assert.equal(findPreviousPromptScrollTop([], 500), null);
  });

  it('jumps to the nearest prompt above current scrollTop', () => {
    const promptOffsets = [20, 600, 1400];
    // At bottom (1800) -> jumps to 1400 - padding(16) = 1384
    assert.equal(findPreviousPromptScrollTop(promptOffsets, 1800), 1384);
    // At 1384 -> jumps to 600 - 16 = 584
    assert.equal(findPreviousPromptScrollTop(promptOffsets, 1384), 584);
    // At 584 -> jumps to 20 - 16 = 4
    assert.equal(findPreviousPromptScrollTop(promptOffsets, 584), 4);
  });

  it('clamps to 0 when already at or above the first prompt', () => {
    const promptOffsets = [10, 600];
    assert.equal(findPreviousPromptScrollTop(promptOffsets, 0), 0);
    assert.equal(findPreviousPromptScrollTop(promptOffsets, 12), 0);
  });
});

describe('createSmoothArrowScroller', () => {
  function createHarness({ scrollTop = 1000, clientHeight = 800, scrollHeight = 4000 } = {}) {
    let nowMs = 0;
    let nextId = 1;
    const frames = new Map();
    const scrollCalls = [];

    const scroller = {
      scrollTop,
      clientHeight,
      scrollHeight,
      scrollTo(opts) {
        scrollCalls.push(['scrollTo', opts]);
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.max(0, Math.min(max, opts.top));
      },
      scrollBy(opts) {
        scrollCalls.push(['scrollBy', opts]);
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.max(0, Math.min(max, scroller.scrollTop + opts.top));
      },
    };

    const requestFrame = (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    };

    const cancelFrame = (id) => {
      frames.delete(id);
    };

    const stepFrame = (dtMs = 16.6667) => {
      nowMs += dtMs;
      const pending = Array.from(frames.entries());
      frames.clear();
      for (const [, cb] of pending) {
        cb(nowMs);
      }
    };

    const advanceMs = (totalMs, stepMs = 16.6667) => {
      const steps = Math.round(totalMs / stepMs);
      for (let i = 0; i < steps; i += 1) {
        if (frames.size === 0) break;
        stepFrame(stepMs);
      }
    };

    const controller = createSmoothArrowScroller({
      getScroller: () => scroller,
      requestFrame,
      cancelFrame,
    });

    return {
      scroller,
      scrollCalls,
      frames,
      stepFrame,
      advanceMs,
      controller,
    };
  }

  it('smoothly scrolls one step on a quick tap without overshoot and stops', () => {
    const h = createHarness({ scrollTop: 1000 });
    h.controller.press(1);
    h.advanceMs(33);
    h.controller.release(1);

    const midScroll = h.scroller.scrollTop;
    assert.ok(midScroll > 1000 && midScroll < 1060, `expected partial smooth progress, got ${midScroll}`);

    h.advanceMs(600);
    assert.equal(h.scroller.scrollTop, 1000 + ARROW_SCROLL_STEP_PX);
    assert.equal(h.frames.size, 0, 'should stop scheduling frames once settled');
  });

  it('scrolls continuously while held and smoothly coasts to a stop on release', () => {
    const h = createHarness({ scrollTop: 1000 });
    h.controller.press(1);

    const deltas = [];
    let prev = h.scroller.scrollTop;
    for (let i = 0; i < 36; i += 1) {
      h.stepFrame(16.6667);
      deltas.push(h.scroller.scrollTop - prev);
      prev = h.scroller.scrollTop;
    }

    // Should move continuously every frame with no zero-delta pauses
    assert.ok(deltas.every((d) => d > 0), 'every held frame should advance forward');
    const steadyDeltas = deltas.slice(18);
    const minSteady = Math.min(...steadyDeltas);
    const maxSteady = Math.max(...steadyDeltas);
    assert.ok(maxSteady - minSteady < 1.5, `steady-state motion should be smooth (range ${minSteady.toFixed(2)}..${maxSteady.toFixed(2)})`);
    assert.ok(h.scroller.scrollTop > 1300, `holding 600ms should scroll continuously past 1300, got ${h.scroller.scrollTop}`);

    // Release -> should smoothly coast forward a bit more, then settle
    const atRelease = h.scroller.scrollTop;
    h.controller.release(1);
    h.advanceMs(600);
    assert.ok(h.scroller.scrollTop > atRelease + 20, 'should coast smoothly on release');
    assert.equal(h.frames.size, 0, 'should stop once coast settles');
  });

  it('stacks rapid taps smoothly without losing steps', () => {
    const h = createHarness({ scrollTop: 1000 });
    for (let i = 0; i < 3; i += 1) {
      h.controller.press(1);
      h.advanceMs(33);
      h.controller.release(1);
      h.advanceMs(50);
    }
    h.advanceMs(600);
    assert.equal(h.scroller.scrollTop, 1000 + 3 * ARROW_SCROLL_STEP_PX);
  });

  it('reverses smoothly and keeps scrolling if the first key is released while the second is held', () => {
    const h = createHarness({ scrollTop: 1000 });
    h.controller.press(1);
    h.advanceMs(200);
    const peakDown = h.scroller.scrollTop;
    assert.ok(peakDown > 1050);

    // Press Up while Down is still held, then release Down
    h.controller.press(-1);
    h.controller.release(1);
    h.advanceMs(350);
    assert.ok(h.scroller.scrollTop < peakDown - 100, 'should continue scrolling up while Up remains held');

    h.controller.release(-1);
    h.advanceMs(600);
    assert.equal(h.frames.size, 0);
  });

  it('clamps cleanly at top and bottom bounds', () => {
    const h = createHarness({ scrollTop: 30, clientHeight: 800, scrollHeight: 2000 });
    h.controller.press(-1);
    h.advanceMs(400);
    assert.equal(h.scroller.scrollTop, 0);
    h.controller.release(-1);
    h.advanceMs(300);
    assert.equal(h.scroller.scrollTop, 0);
    assert.equal(h.frames.size, 0);

    // Bottom bound (maxScroll = 2000 - 800 = 1200)
    h.scroller.scrollTop = 1170;
    h.controller.press(1);
    h.advanceMs(400);
    assert.equal(h.scroller.scrollTop, 1200);
    h.controller.release(1);
    h.advanceMs(300);
    assert.equal(h.scroller.scrollTop, 1200);
    assert.equal(h.frames.size, 0);
  });

  it('stops coasting if scrollTop is changed externally', () => {
    const h = createHarness({ scrollTop: 1000 });
    h.controller.press(1);
    h.advanceMs(33);
    h.controller.release(1);
    h.stepFrame(16.6667);

    // Simulate user wheel scroll jumping elsewhere
    h.scroller.scrollTop = 1500;
    h.stepFrame(16.6667);
    assert.equal(h.scroller.scrollTop, 1500);
    assert.equal(h.frames.size, 0);
  });

  it('cancels animation immediately on stop()', () => {
    const h = createHarness({ scrollTop: 1000 });
    h.controller.press(1);
    h.advanceMs(100);
    const stoppedAt = h.scroller.scrollTop;
    h.controller.stop();
    assert.equal(h.frames.size, 0);
    h.advanceMs(300);
    assert.equal(h.scroller.scrollTop, stoppedAt);
  });

  it('falls back to smooth scrollBy when requestAnimationFrame is unavailable', () => {
    const calls = [];
    const scroller = {
      scrollTop: 500,
      scrollBy(opts) {
        calls.push(opts);
      },
    };
    const controller = createSmoothArrowScroller({
      getScroller: () => scroller,
      requestFrame: null,
      cancelFrame: null,
    });
    controller.press(-1);
    assert.deepEqual(calls, [{ top: -ARROW_SCROLL_STEP_PX, behavior: 'smooth' }]);
  });
});
