import { describe, expect, it } from 'vitest';
import { asepriteJson, classify, Px, processSheet, type Rgba } from '../../tools/art/process';

// Synthetic "generated" sheet: magenta background, 5 rows x 4 cells, each with a body block,
// a green team-cloth stripe and a pink fringe ring that must be removed.
function synthSheet(): Rgba {
  const cell = 100, W = cell * 4, H = cell * 5;
  const data = new Uint8Array(W * H * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => { const o = (y * W + x) * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 255, 0, 255);
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 4; c++) {
      const x0 = c * cell + 35 + (r === 1 ? (c % 2) * 6 : 0); // walk frames shift inside their cell
      const y1 = r * cell + 90;
      const h = 60;
      for (let y = y1 - h - 1; y <= y1; y++) for (let x = x0 - 1; x <= x0 + 31; x++) set(x, y, 230, 120, 230); // pink fringe
      for (let y = y1 - h; y < y1; y++) for (let x = x0; x < x0 + 30; x++) set(x, y, 120, 80, 40);
      for (let y = y1 - 40; y < y1 - 30; y++) for (let x = x0; x < x0 + 30; x++) set(x, y, 0, 220, 0);
    }
  return { width: W, height: H, data };
}

const opts = { targetHeight: 30, rows: ['idle', 'walk', 'attack', 'hit', 'death'] as const, framesPerRow: 4, alphaCut: 120, outline: null };

describe('art processing', () => {
  it('classifies key colours', () => {
    expect(classify(255, 0, 255)).toBe(Px.Bg);
    expect(classify(0, 255, 0)).toBe(Px.Cloth);
    expect(classify(120, 80, 40)).toBe(Px.Fg);
  });

  it('slices a 5x4 sheet, scales to target height, separates cloth into the mask, drops fringe', () => {
    const res = processSheet(synthSheet(), opts);
    expect(res.scale).toBeCloseTo(30 / 62, 1);
    const { width: SW, data } = res.body;
    // Collect alpha rows of frame 0 to measure height; check no pink pixels survive anywhere.
    let top = Infinity, bottom = -1, pink = 0, maskPx = 0;
    for (let y = 0; y < res.frameH; y++) for (let x = 0; x < res.frameW; x++) {
      const o = (y * SW + x) * 4;
      if (data[o + 3]) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] && data[i]! > 200 && data[i + 2]! > 200 && data[i + 1]! < 150) pink++;
      if (res.mask.data[i + 3]) maskPx++;
    }
    expect(bottom - top + 1).toBeGreaterThanOrEqual(29);
    expect(bottom - top + 1).toBeLessThanOrEqual(32);
    expect(pink).toBe(0);
    expect(maskPx).toBeGreaterThan(20 * 4 * 5);
  });

  it('anchors frames to cells so in-cell motion is preserved (no re-centring)', () => {
    const res = processSheet(synthSheet(), opts);
    const leftEdge = (row: number, k: number) => {
      for (let x = 0; x < res.frameW; x++)
        for (let y = 0; y < res.frameH; y++) if (res.body.data[(((row * res.frameH + y) * res.body.width) + k * res.frameW + x) * 4 + 3]) return x;
      return -1;
    };
    // walk frames 0 and 1 differ by 6 source px (~3 game px); idle frames identical
    expect(leftEdge(0, 0)).toBe(leftEdge(0, 1));
    expect(Math.abs(leftEdge(1, 1) - leftEdge(1, 0))).toBeGreaterThanOrEqual(2);
  });

  it('rejects sheets with the wrong grid', () => {
    const img = synthSheet();
    for (let i = 0; i < img.width * 100 * 4; i += 4) { img.data[i] = 255; img.data[i + 1] = 0; img.data[i + 2] = 255; } // blank the first row
    expect(() => processSheet(img, opts)).toThrow(/expected 5 rows/);
  });

  it('writes Aseprite JSON with one tag per animation', () => {
    const res = processSheet(synthSheet(), opts);
    const json = asepriteJson('dog', 'dog.png', res, opts.rows, 4, { idle: 100, walk: 100, attack: 80, hit: 90, death: 120 });
    expect(json.meta.frameTags.map((t) => t.name)).toEqual([...opts.rows]);
    expect(Object.keys(json.frames)).toHaveLength(20);
  });
});
