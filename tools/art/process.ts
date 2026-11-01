// Deterministic post-processing: raw Codex sheet -> game sprite sheet + team-cloth mask + Aseprite JSON.
// Pure functions over RGBA buffers (tested in tests/art/process.test.ts); file IO lives in cli.ts.
import type { Anim } from './config';

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array | Buffer; // RGBA
}

export const enum Px {
  Bg = 0,
  Fg = 1,
  Cloth = 2,
}

export interface ProcessOptions {
  targetHeight: number; // idle frame height in game px
  rows: readonly Anim[];
  framesPerRow: number;
  alphaCut: number; // 0-255
  outline: [number, number, number] | null;
}

export interface ProcessResult {
  frameW: number;
  frameH: number;
  /** Sprite sheet, framesPerRow x rows grid of frames. Cloth pixels are neutral grey (luminance). */
  body: Rgba;
  /** Same layout; cloth pixels only (grey luminance, alpha 255) for runtime team tinting. */
  mask: Rgba;
  warnings: string[];
  scale: number;
}

export function classify(r: number, g: number, b: number): Px {
  const magenta = Math.min(r, b) - g;
  if (magenta > 70 && r > 110 && b > 110) return Px.Bg;
  if (g - Math.max(r, b) > 60 && g > 90) return Px.Cloth;
  return Px.Fg;
}

/** Per-pixel class map with magenta fringe removal along silhouette edges. */
export function classMap(img: Rgba): Uint8Array {
  const { width: W, height: H, data } = img;
  const map = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const a = data[p + 3]!;
    map[i] = a < 128 ? Px.Bg : classify(data[p]!, data[p + 1]!, data[p + 2]!);
  }
  // Fringe: foreground pixels near the background that are still pink-tinted become background.
  const out = map.slice();
  const R = 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (map[i] === Px.Bg) continue;
      const p = i * 4;
      const pink = Math.min(data[p]!, data[p + 2]!) - data[p + 1]!;
      if (pink <= 25) continue;
      let nearBg = false;
      for (let dy = -R; dy <= R && !nearBg; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < H && xx >= 0 && xx < W && map[yy * W + xx] === Px.Bg) {
            nearBg = true;
            break;
          }
        }
      if (nearBg) out[i] = Px.Bg;
    }
  }
  return out;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number; // exclusive
  area: number;
}

/** Connected foreground blobs on a downsampled + dilated mask (merges weapons/limbs into one figure). */
export function findBlobs(map: Uint8Array, W: number, H: number, step = 4, dilate = 2): Box[] {
  const mw = Math.ceil(W / step), mh = Math.ceil(H / step);
  let m = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++) {
      let any = 0;
      for (let yy = y * step; yy < Math.min(H, (y + 1) * step) && !any; yy++)
        for (let xx = x * step; xx < Math.min(W, (x + 1) * step); xx++) if (map[yy * W + xx] !== Px.Bg) { any = 1; break; }
      m[y * mw + x] = any;
    }
  for (let it = 0; it < dilate; it++) {
    const n = m.slice();
    for (let y = 0; y < mh; y++)
      for (let x = 0; x < mw; x++)
        if (m[y * mw + x]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < mw && yy >= 0 && yy < mh) n[yy * mw + xx] = 1;
        }
    m = n;
  }
  const seen = new Uint8Array(mw * mh);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let s = 0; s < mw * mh; s++) {
    if (!m[s] || seen[s]) continue;
    seen[s] = 1;
    stack.push(s);
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, area = 0;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % mw, cy = (c - cx) / mw;
      area++;
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || xx >= mw || yy < 0 || yy >= mh) continue;
        const k = yy * mw + xx;
        if (m[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    // Undo dilation for the tight box; keep blobs that are big enough to be a figure.
    const box = { x0: (x0 + dilate) * step, y0: (y0 + dilate) * step, x1: (x1 + 1 - dilate) * step, y1: (y1 + 1 - dilate) * step, area };
    boxes.push({ ...box, x0: Math.max(0, Math.min(box.x0, W)), y0: Math.max(0, box.y0), x1: Math.min(W, Math.max(box.x1, box.x0 + 1)), y1: Math.min(H, Math.max(box.y1, box.y0 + 1)) });
  }
  if (!boxes.length) return boxes;
  const maxArea = Math.max(...boxes.map((b) => b.area));
  return boxes.filter((b) => b.area >= maxArea * 0.08).map((b) => tighten(map, W, H, b, step * (dilate + 1)));
}

/** Exact pixel bounds of foreground inside a coarse box (grown by `pad`). */
function tighten(map: Uint8Array, W: number, H: number, b: Box, pad: number): Box {
  const X0 = Math.max(0, b.x0 - pad), Y0 = Math.max(0, b.y0 - pad), X1 = Math.min(W, b.x1 + pad), Y1 = Math.min(H, b.y1 + pad);
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = Y0; y < Y1; y++)
    for (let x = X0; x < X1; x++)
      if (map[y * W + x] !== Px.Bg) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? b : { x0, y0, x1: x1 + 1, y1: y1 + 1, area: b.area };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/** Group blobs into rows (by vertical centre) and sort each row left-to-right. */
export function gridFromBlobs(boxes: Box[]): Box[][] {
  const sorted = [...boxes].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const medH = median(boxes.map((b) => b.y1 - b.y0));
  const rows: Box[][] = [];
  let lastC = -Infinity;
  for (const b of sorted) {
    const c = (b.y0 + b.y1) / 2;
    if (rows.length && c - lastC < medH * 0.5) rows[rows.length - 1]!.push(b);
    else rows.push([b]);
    lastC = c;
  }
  return rows.map((r) => r.sort((a, b) => a.x0 - b.x0));
}

export function processSheet(img: Rgba, opts: ProcessOptions): ProcessResult {
  const { width: W, height: H, data } = img;
  const warnings: string[] = [];
  const map = classMap(img);
  let rows = gridFromBlobs(findBlobs(map, W, H));
  // Dilation joins detached equipment, but can also bridge a narrow gutter between
  // animation rows. Retry less dilation only when the original grid is invalid;
  // each candidate must still pass the same row/column validation.
  const validGrid = (grid: Box[][]) => grid.length === opts.rows.length
    && grid.filter((r) => r.length === opts.framesPerRow).length >= Math.ceil(opts.rows.length / 2)
    && grid.every((r) => r.length <= opts.framesPerRow);
  if (!validGrid(rows)) {
    for (const dilation of [1, 0]) {
      const candidate = gridFromBlobs(findBlobs(map, W, H, 4, dilation));
      if (!validGrid(candidate)) continue;
      rows = candidate;
      warnings.push(`reduced blob dilation to ${dilation} to preserve cell gutters`);
      break;
    }
  }
  const counts = rows.map((r) => r.length);
  const fullRows = rows.filter((r) => r.length === opts.framesPerRow);
  // Rows must match; columns are estimated from complete rows. A row whose neighbouring figures touch
  // (e.g. two lying death frames) is still fine: pixels are assigned by cell, not by blob.
  if (!validGrid(rows)) {
    throw new Error(`expected ${opts.rows.length} rows x ${opts.framesPerRow} frames, found rows ${JSON.stringify(counts)}`);
  }
  if (fullRows.length < rows.length) warnings.push(`merged figures in row(s) ${counts.map((c, i) => (c < opts.framesPerRow ? opts.rows[i] : null)).filter(Boolean).join(', ')}; split by grid columns`);

  // Column centres shared by all rows (the model draws a uniform grid): anchoring frames to cells
  // instead of re-centring each figure keeps the animation from jittering sideways.
  const cx = (b: Box) => (b.x0 + b.x1) / 2;
  const colCenters = Array.from({ length: opts.framesPerRow }, (_, k) => median(fullRows.map((r) => cx(r[k]!))));
  const pitchX = median(colCenters.slice(1).map((c, k) => c - colCenters[k]!)) || W / opts.framesPerRow;
  const rowBands = rows.map((r) => ({ top: Math.min(...r.map((b) => b.y0)), base: Math.max(...r.map((b) => b.y1)) }));

  const idleH = median(rows[0]!.map((b) => b.y1 - b.y0));
  const scale = opts.targetHeight / idleH;
  const bandH = Math.max(...rowBands.map((b) => b.base - b.top));
  const frameW = Math.ceil(pitchX * scale) + 2;
  const frameH = Math.ceil(bandH * scale) + 2;

  // Sanity checks that catch common model failures without rejecting the sheet.
  const idleHeights = rows[0]!.map((b) => b.y1 - b.y0);
  if (Math.max(...idleHeights) / Math.min(...idleHeights) > 1.15) warnings.push('idle frames vary in height by >15% (scale drift)');
  const walkRow = rows[opts.rows.indexOf('walk')];
  const walkBase = walkRow?.map((b) => b.y1) ?? [];
  if (walkBase.length && Math.max(...walkBase) - Math.min(...walkBase) > idleH * 0.08) warnings.push('walk frames do not share a baseline');
  let clothPx = 0, fgPx = 0;
  for (let i = 0; i < map.length; i++) { if (map[i] === Px.Cloth) clothPx++; if (map[i] !== Px.Bg) fgPx++; }
  if (clothPx / Math.max(1, fgPx) < 0.02) warnings.push('almost no #00FF00 team-cloth pixels: team colour will not show on the sprite');

  const SW = frameW * opts.framesPerRow, SH = frameH * opts.rows.length;
  const body = new Uint8Array(SW * SH * 4);
  const mask = new Uint8Array(SW * SH * 4);
  const inv = 1 / scale;

  for (let r = 0; r < rows.length; r++) {
    const band = rowBands[r]!;
    for (let k = 0; k < opts.framesPerRow; k++) {
      // Source point that maps to frame (0,0): cell left edge, baseline - frame height.
      const srcLeft = colCenters[k]! - (frameW / 2) * inv;
      const srcTop = band.base - (frameH - 1) * inv;
      for (let oy = 0; oy < frameH; oy++) {
        const sy0 = Math.floor(srcTop + oy * inv), sy1 = Math.max(sy0 + 1, Math.floor(srcTop + (oy + 1) * inv));
        for (let ox = 0; ox < frameW; ox++) {
          const sx0 = Math.floor(srcLeft + ox * inv), sx1 = Math.max(sx0 + 1, Math.floor(srcLeft + (ox + 1) * inv));
          // Never sample from a neighbouring cell or row.
          const cellL = colCenters[k]! - pitchX / 2, cellR = colCenters[k]! + pitchX / 2;
          let n = 0, fr = 0, fg = 0, fb = 0, fcount = 0, cloth = 0, clothLum = 0;
          for (let sy = sy0; sy < sy1; sy++) {
            if (sy < band.top - 2 || sy >= band.base + 2 || sy < 0 || sy >= H) { n += sx1 - sx0; continue; }
            for (let sx = sx0; sx < sx1; sx++) {
              n++;
              if (sx < cellL || sx >= cellR || sx < 0 || sx >= W) continue;
              const i = sy * W + sx;
              const c = map[i]!;
              if (c === Px.Bg) continue;
              const p = i * 4;
              fcount++;
              if (c === Px.Cloth) {
                cloth++;
                clothLum += data[p + 1]!; // green channel carries the cloth shading
              } else {
                fr += data[p]!; fg += data[p + 1]!; fb += data[p + 2]!;
              }
            }
          }
          if (!n || fcount / n * 255 < opts.alphaCut) continue;
          const o = (((r * frameH + oy) * SW) + k * frameW + ox) * 4;
          if (cloth * 2 >= fcount) {
            const v = Math.round(Math.min(255, (clothLum / cloth) * 1.1));
            body[o] = body[o + 1] = body[o + 2] = v;
            body[o + 3] = 255;
            mask[o] = mask[o + 1] = mask[o + 2] = v;
            mask[o + 3] = 255;
          } else {
            const m = fcount - cloth;
            body[o] = Math.round(fr / m); body[o + 1] = Math.round(fg / m); body[o + 2] = Math.round(fb / m);
            body[o + 3] = 255;
          }
        }
      }
    }
  }

  removeSpecks(body, mask, SW, frameW, frameH, opts.framesPerRow, opts.rows.length);
  if (opts.outline) addOutline(body, SW, SH, frameW, frameH, opts.outline);
  return { frameW, frameH, body: { width: SW, height: SH, data: body }, mask: { width: SW, height: SH, data: mask }, warnings, scale };
}

/** Drop tiny detached islands (sparkles, stray pixels) per frame; keep anything >= 15% of the largest. */
function removeSpecks(body: Uint8Array, mask: Uint8Array, SW: number, fw: number, fh: number, cols: number, rows: number): void {
  const seen = new Uint8Array(fw * fh);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      seen.fill(0);
      const comps: number[][] = [];
      const idx = (x: number, y: number) => ((r * fh + y) * SW + c * fw + x) * 4;
      for (let y = 0; y < fh; y++)
        for (let x = 0; x < fw; x++) {
          if (seen[y * fw + x] || !body[idx(x, y) + 3]) continue;
          const comp: number[] = [];
          const stack = [y * fw + x];
          seen[y * fw + x] = 1;
          while (stack.length) {
            const p = stack.pop()!;
            comp.push(p);
            const px = p % fw, py = (p - px) / fw;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const nx = px + dx, ny = py + dy;
                if (nx < 0 || ny < 0 || nx >= fw || ny >= fh || seen[ny * fw + nx] || !body[idx(nx, ny) + 3]) continue;
                seen[ny * fw + nx] = 1;
                stack.push(ny * fw + nx);
              }
          }
          comps.push(comp);
        }
      const largest = Math.max(0, ...comps.map((k) => k.length));
      for (const k of comps)
        if (k.length < largest * 0.15)
          for (const p of k) {
            const o = idx(p % fw, Math.floor(p / fw));
            body[o + 3] = 0;
            mask[o + 3] = 0;
          }
    }
}

/** 1px outline outside the silhouette, within each frame (helps readability at small size). */
function addOutline(px: Uint8Array, SW: number, SH: number, fw: number, fh: number, [r, g, b]: [number, number, number]): void {
  const src = px.slice();
  const solid = (x: number, y: number) => src[(y * SW + x) * 4 + 3]! > 0;
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < SW; x++) {
      if (solid(x, y)) continue;
      const fx = x % fw, fy = y % fh;
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = fx + dx, ny = fy + dy;
        if (nx < 0 || nx >= fw || ny < 0 || ny >= fh) continue;
        if (solid(x + dx, y + dy)) { edge = true; break; }
      }
      if (edge) {
        const o = (y * SW + x) * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
}

/** Aseprite "hash" JSON consumed by src/render/spriteSheets.ts. */
export function asepriteJson(id: string, image: string, res: Pick<ProcessResult, 'frameW' | 'frameH' | 'body'>, rows: readonly Anim[], framesPerRow: number, frameMs: Record<Anim, number>) {
  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; duration: number }> = {};
  const frameTags: { name: string; from: number; to: number; direction: 'forward' }[] = [];
  let i = 0;
  rows.forEach((anim, r) => {
    const from = i;
    for (let k = 0; k < framesPerRow; k++, i++) {
      frames[`${id} ${i}`] = { frame: { x: k * res.frameW, y: r * res.frameH, w: res.frameW, h: res.frameH }, duration: frameMs[anim] };
    }
    frameTags.push({ name: anim, from, to: i - 1, direction: 'forward' });
  });
  return {
    frames,
    meta: { app: 'dragonland art pipeline', image, format: 'RGBA8888', size: { w: res.body.width, h: res.body.height }, scale: '1', frameTags },
  };
}

export interface RowRef {
  anim: Anim;
  res: ProcessResult;
  row: number; // row index inside res
  frames: number;
}

/**
 * Pack animation rows taken from one or more processed sheets into a single sheet (each row keeps
 * its own frame size; frames are bottom-centre anchored so mixed sizes line up in game).
 * Used to swap a regenerated animation (e.g. walk) into an otherwise unchanged sheet.
 */
export function packRows(id: string, image: string, rows: RowRef[], frameMs: Record<Anim, number>) {
  const W = Math.max(...rows.map((r) => r.res.frameW * r.frames));
  const H = rows.reduce((n, r) => n + r.res.frameH, 0);
  const body = new Uint8Array(W * H * 4);
  const mask = new Uint8Array(W * H * 4);
  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; duration: number }> = {};
  const frameTags: { name: string; from: number; to: number; direction: 'forward' }[] = [];
  let y = 0;
  let i = 0;
  for (const r of rows) {
    const { frameW: fw, frameH: fh } = r.res;
    const SW = r.res.body.width;
    for (let k = 0; k < r.frames; k++)
      for (let yy = 0; yy < fh; yy++) {
        const src = ((r.row * fh + yy) * SW + k * fw) * 4;
        const dst = ((y + yy) * W + k * fw) * 4;
        body.set(r.res.body.data.subarray(src, src + fw * 4), dst);
        mask.set(r.res.mask.data.subarray(src, src + fw * 4), dst);
      }
    const from = i;
    for (let k = 0; k < r.frames; k++, i++) frames[`${id} ${i}`] = { frame: { x: k * fw, y, w: fw, h: fh }, duration: frameMs[r.anim] };
    frameTags.push({ name: r.anim, from, to: i - 1, direction: 'forward' });
    y += fh;
  }
  return {
    body: { width: W, height: H, data: body } as Rgba,
    mask: { width: W, height: H, data: mask } as Rgba,
    json: { frames, meta: { app: 'dragonland art pipeline', image, format: 'RGBA8888', size: { w: W, h: H }, scale: '1', frameTags } },
  };
}

/** Median opaque height (px) of the frames in one row of a processed sheet. */
export function rowFigureHeight(res: ProcessResult, row: number, frames: number): number {
  const hs: number[] = [];
  const SW = res.body.width;
  for (let k = 0; k < frames; k++) {
    let top = -1, bottom = -1;
    for (let y = 0; y < res.frameH; y++)
      for (let x = 0; x < res.frameW; x++)
        if (res.body.data[(((row * res.frameH + y) * SW) + k * res.frameW + x) * 4 + 3]) {
          if (top < 0) top = y;
          bottom = y;
        }
    if (top >= 0) hs.push(bottom - top + 1);
  }
  hs.sort((a, b) => a - b);
  return hs.length ? hs[Math.floor(hs.length / 2)]! : res.frameH;
}
