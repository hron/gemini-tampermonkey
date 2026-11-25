import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARROW_SCROLL_STEP_PX,
  PAGE_SCROLL_RATIO,
  computeScrollAction,
  findPreviousPromptScrollTop,
  applyScrollAction,
} from '../src/lib/scrolling.js';

describe('computeScrollAction', () => {
  const metrics = {
    clientHeight: 800,
    scrollHeight: 3200,
    scrollTop: 1000,
  };

  it('scrolls up by ARROW_SCROLL_STEP_PX on ArrowUp', () => {
    const action = computeScrollAction({ key: 'ArrowUp' }, metrics);
    assert.deepEqual(action, {
      type: 'by',
      delta: -ARROW_SCROLL_STEP_PX,
      behavior: 'instant',
    });
  });

  it('scrolls down by ARROW_SCROLL_STEP_PX on ArrowDown', () => {
    const action = computeScrollAction({ key: 'ArrowDown' }, metrics);
    assert.deepEqual(action, {
      type: 'by',
      delta: ARROW_SCROLL_STEP_PX,
      behavior: 'instant',
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
