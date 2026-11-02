import { describe, expect, it, vi } from 'vitest';
import { bindDragEvents } from '../../src/battle/pointerInput';

describe('battle pointer lifecycle', () => {
  it('detaches global drag listeners and ends drag exactly once on teardown', () => {
    const canvas = new EventTarget(), windowTarget = new EventTarget();
    const down = vi.fn(), move = vi.fn(), end = vi.fn();
    const detach = bindDragEvents(canvas, windowTarget, { down, move, end });
    canvas.dispatchEvent(new Event('pointerdown'));
    windowTarget.dispatchEvent(new Event('pointermove'));
    expect(down).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
    detach();
    detach();
    canvas.dispatchEvent(new Event('pointerdown'));
    windowTarget.dispatchEvent(new Event('pointermove'));
    windowTarget.dispatchEvent(new Event('pointerup'));
    expect(down).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('cancels dragging on pointer cancellation or lost pointer capture', () => {
    const canvas = new EventTarget(), windowTarget = new EventTarget();
    const end = vi.fn();
    const detach = bindDragEvents(canvas, windowTarget, { down: vi.fn(), move: vi.fn(), end });
    windowTarget.dispatchEvent(new Event('pointercancel'));
    canvas.dispatchEvent(new Event('lostpointercapture'));
    expect(end).toHaveBeenCalledTimes(2);
    detach();
  });

  it('does not keep callbacks from previous battle views', () => {
    const windowTarget = new EventTarget();
    const oldMove = vi.fn(), nextMove = vi.fn();
    const first = bindDragEvents(new EventTarget(), windowTarget, { down: vi.fn(), move: oldMove, end: vi.fn() });
    first();
    const second = bindDragEvents(new EventTarget(), windowTarget, { down: vi.fn(), move: nextMove, end: vi.fn() });
    windowTarget.dispatchEvent(new Event('pointermove'));
    expect(oldMove).not.toHaveBeenCalled();
    expect(nextMove).toHaveBeenCalledTimes(1);
    second();
  });
});
