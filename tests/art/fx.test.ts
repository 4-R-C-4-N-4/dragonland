import { describe, expect, it } from 'vitest';
import { fxAsepriteJson, sliceFxStrip, type FxSliceResult } from '../../tools/art/fx';
import type { Rgba } from '../../tools/art/process';

/** A magenta-background strip with N solid-colour blobs, one per cell, offset so cells aren't symmetric. */
function synthStrip(frames: number, cell = 40): Rgba {
  const W = cell * frames, H = cell;
  const data = new Uint8Array(W * H * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const o = (y * W + x) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 255, 0, 255);
  for (let k = 0; k < frames; k++) {
    const x0 = k * cell + 10 + k; // each frame's blob is a bit bigger/offset, like a growing fx
    for (let y = 10; y < 30; y++) for (let x = x0; x < x0 + 15; x++) if (x < (k + 1) * cell) set(x, y, 255, 140, 20);
  }
  return { width: W, height: H, data };
}

describe('fx strip slicing', () => {
  it('slices N equal cells, dropping the magenta background to transparency', () => {
    const res = sliceFxStrip(synthStrip(6), 6);
    expect(res.frames).toBe(6);
    expect(res.frameW).toBe(40);
    expect(res.frameH).toBe(40);
    // Each frame has some opaque pixels (the blob) and the corners stay transparent.
    for (let k = 0; k < 6; k++) {
      let opaque = 0;
      for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
        const o = (y * res.body.width + k * 40 + x) * 4;
        if (res.body.data[o + 3]) opaque++;
      }
      expect(opaque).toBeGreaterThan(0);
    }
    // Top-left corner of frame 0 is background -> transparent.
    expect(res.body.data[3]).toBe(0);
  });

  it('rejects a width not divisible by the frame count', () => {
    expect(() => sliceFxStrip(synthStrip(6), 7)).toThrow();
  });

  it('builds Aseprite-style JSON with a single play tag spanning all frames', () => {
    const res: FxSliceResult = sliceFxStrip(synthStrip(8, 20), 8);
    const json = fxAsepriteJson('meteor-fall', 'meteor-fall.png', res, 90);
    expect(Object.keys(json.frames)).toHaveLength(8);
    expect(json.meta.frameTags).toEqual([{ name: 'play', from: 0, to: 7, direction: 'forward' }]);
    expect(json.frames['meteor-fall 0']!.frame).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(json.frames['meteor-fall 7']!.frame).toEqual({ x: 140, y: 0, w: 20, h: 20 });
    expect(json.frames['meteor-fall 0']!.duration).toBe(90);
  });
});
