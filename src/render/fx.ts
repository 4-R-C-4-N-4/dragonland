// Special-attack FX: sheet discovery + pure placement helpers (MVP2 B3).
// Mirrors spriteSheets.ts: `assets/fx/<fx>.png` + `<fx>.json` are discovered with import.meta.glob
// and the renderer falls back to the existing placeholder graphics when a sheet is missing.
// Placement helpers are pure (no Pixi) so they're unit-testable without rendering.

export interface FxFrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  durationMs: number;
}

export interface ParsedFx {
  fxId: string;
  imageUrl: string;
  frameW: number;
  frameH: number;
  frames: FxFrameRect[]; // the 'play' tag, in order
}

interface AseFrame {
  frame: { x: number; y: number; w: number; h: number };
  duration?: number;
}
interface AseJson {
  frames: Record<string, AseFrame> | AseFrame[];
  meta?: { frameTags?: { name: string; from: number; to: number; direction?: string }[] };
}

function isAseJson(v: unknown): v is AseJson {
  if (typeof v !== 'object' || v === null) return false;
  const f = (v as { frames?: unknown }).frames;
  return typeof f === 'object' && f !== null;
}

/** Parse an fx sprite-strip JSON (same shape family as unit sheets, but a single 'play' tag). */
export function parseFxSheet(fxId: string, imageUrl: string, json: unknown): ParsedFx {
  if (!isAseJson(json)) throw new Error(`fx sheet ${fxId}: not Aseprite-style JSON (missing frames)`);
  const list: AseFrame[] = Array.isArray(json.frames) ? json.frames : Object.values(json.frames);
  if (list.length === 0) throw new Error(`fx sheet ${fxId}: no frames`);
  const rects = list.map((f, i) => {
    const r = f.frame;
    if (!r || ![r.x, r.y, r.w, r.h].every((n) => typeof n === 'number')) throw new Error(`fx sheet ${fxId}: bad frame ${i}`);
    return { x: r.x, y: r.y, w: r.w, h: r.h, durationMs: f.duration ?? 80 };
  });
  const play = json.meta?.frameTags?.find((t) => t.name.toLowerCase() === 'play');
  const from = play ? Math.max(0, play.from) : 0;
  const to = play ? Math.min(rects.length - 1, play.to) : rects.length - 1;
  const frames = to >= from ? rects.slice(from, to + 1) : rects;
  const first = frames[0]!;
  return { fxId, imageUrl, frameW: first.w, frameH: first.h, frames };
}

/** Pair `<fx>.json` modules with `<fx>.png` urls from glob maps. Exported for tests. */
export function collectFx(jsonModules: Record<string, unknown>, pngUrls: Record<string, string>, onError: (msg: string) => void = () => {}): Map<string, ParsedFx> {
  const byBase = (p: string) => p.replace(/^.*\//, '').replace(/\.(json|png)$/, '');
  const pngs = new Map(Object.entries(pngUrls).map(([p, url]) => [byBase(p), url] as const));
  const out = new Map<string, ParsedFx>();
  for (const [path, mod] of Object.entries(jsonModules).sort(([a], [b]) => a.localeCompare(b))) {
    const fxId = byBase(path);
    const url = pngs.get(fxId);
    if (!url) {
      onError(`fx sheet ${fxId}: json without matching png`);
      continue;
    }
    const json = (mod as { default?: unknown }).default ?? mod;
    try {
      out.set(fxId, parseFxSheet(fxId, url, json));
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    }
  }
  return out;
}

/** Discover all fx sheets under /assets/fx at build time (Vite). Tolerant of none existing. */
export function discoverFx(onError?: (msg: string) => void): Map<string, ParsedFx> {
  const jsons = import.meta.glob('../../assets/fx/*.json', { eager: true });
  const pngs = import.meta.glob('../../assets/fx/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
  return collectFx(jsons, pngs, onError);
}

// ---------- pure placement helpers (render-side randomness; sim stays deterministic) ----------

/** Tiny xorshift32 PRNG so placement is reproducible from a numeric seed (tests, replay). */
export function seededRandom(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** How many overlay instances to scatter across a field of this size (sparse but readable). */
export function overlayScatterCount(fieldW: number, fieldH: number, density = 1 / 3500): number {
  return Math.max(6, Math.min(40, Math.round(fieldW * fieldH * density)));
}

/** Scattered points covering the whole field, seeded for determinism (overlay-kind specials). */
export function overlayPoints(fieldW: number, fieldH: number, seed: number, count = overlayScatterCount(fieldW, fieldH)): [number, number][] {
  const rnd = seededRandom(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) pts.push([rnd() * fieldW, rnd() * fieldH]);
  return pts;
}

/**
 * Points along a travelling wave: evenly spaced along (dirX,dirY) through the caster, spanning
 * well past both field edges, each jittered within the half-width band (wave-kind specials).
 */
export function wavePoints(x: number, y: number, dirX: number, dirY: number, width: number, fieldW: number, fieldH: number, seed: number, count = 14): [number, number][] {
  const len = Math.hypot(fieldW, fieldH) * 1.2;
  const dLen = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / dLen;
  const uy = dirY / dLen;
  const px = -uy;
  const py = ux;
  const rnd = seededRandom(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / Math.max(1, count - 1) - 0.5) * len;
    const off = (rnd() * 2 - 1) * width;
    pts.push([x + ux * t + px * off, y + uy * t + py * off]);
  }
  return pts;
}

/** Strike/aura placement: one instance per affected entity, resolved by the caller's position lookup. */
export function perEntityPoints(affected: readonly number[], posOf: (entity: number) => [number, number] | null): [number, number][] {
  const pts: [number, number][] = [];
  for (const e of affected) {
    const p = posOf(e);
    if (p) pts.push(p);
  }
  return pts;
}

export type FxKind = 'overlay' | 'wave' | 'strike' | 'aura';

/** The playback kind implied by one SpecialArea tag (areas carry their own semantics already). */
export function kindForArea(area: string): FxKind {
  if (area === 'field') return 'overlay';
  if (area === 'wave') return 'wave';
  if (area === 'heal' || area === 'buff' || area === 'debuff') return 'aura';
  return 'strike'; // random | general
}

/** Explicit maximum extent in battlefield units, independent of source resolution. */
export function fxSize(kind: FxKind, frameW: number, frameH: number, fxId?: string | null): { width: number; height: number } {
  const extent = kind === 'aura' && fxId === 'guiding-light' ? 90 : { overlay: 96, wave: 110, strike: 64, aura: 60 }[kind];
  const scale = extent / Math.max(1, frameW, frameH);
  return { width: frameW * scale, height: frameH * scale };
}

/** Give the narrow support beam time to read; does not alter simulation buff duration. */
export function fxDurationScale(fxId?: string | null): number {
  return fxId === 'guiding-light' ? 2 : 1;
}

/** Forward crossing, with starts spread over 0.7 seconds rather than simultaneous stamps. */
export function timedWavePoints(x: number, y: number, dirX: number, dirY: number, width: number, fieldW: number, fieldH: number, seed: number, count = 14): { x: number; y: number; delayS: number }[] {
  const dLen = Math.hypot(dirX, dirY);
  const ux = dLen ? dirX / dLen : 1, uy = dLen ? dirY / dLen : 0;
  const px = -uy, py = ux;
  // First intersection of the forward ray with the actual rectangular field.
  const edgeX = ux > 0 ? (fieldW - x) / ux : ux < 0 ? -x / ux : Infinity;
  const edgeY = uy > 0 ? (fieldH - y) / uy : uy < 0 ? -y / uy : Infinity;
  const distance = Math.max(0, Math.min(edgeX, edgeY));
  const rnd = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => {
    const progress = i / Math.max(1, count - 1);
    const cx = x + ux * progress * distance, cy = y + uy * progress * distance;
    // Restrict the perpendicular band itself; clipping coordinates independently
    // would change forward progress and could move centers backwards.
    let low = -Math.abs(width), high = Math.abs(width);
    for (const [center, perpendicular, limit] of [[cx, px, fieldW], [cy, py, fieldH]] as const) {
      if (perpendicular === 0) continue;
      const a = -center / perpendicular, b = (limit - center) / perpendicular;
      low = Math.max(low, Math.min(a, b));
      high = Math.min(high, Math.max(a, b));
    }
    const jitter = rnd();
    const off = i === count - 1 ? 0 : low + jitter * (high - low);
    // Clamp only floating-point roundoff at the boundary.
    return { x: Math.max(0, Math.min(fieldW, cx + px * off)), y: Math.max(0, Math.min(fieldH, cy + py * off)), delayS: progress * 0.7 };
  });
}

/** Owned by the renderer: no ticker, rAF, timer or asynchronous completion chain. */
export class FxTimeline {
  private jobs: { age: number; duration: number; frame: (elapsed: number) => void }[] = [];
  private destroyed = false;

  add(duration: number, frame: (elapsed: number) => void): void {
    if (this.destroyed) return;
    frame(0);
    if (duration > 0 && !this.destroyed) this.jobs.push({ age: 0, duration, frame });
  }

  schedule(delay: number, callback: () => void): void {
    if (this.destroyed) return;
    if (delay <= 0) { callback(); return; }
    this.jobs.push({ age: 0, duration: delay, frame: (elapsed) => { if (elapsed >= delay) callback(); } });
  }

  update(dt: number): void {
    if (this.destroyed || dt <= 0) return;
    const jobs = this.jobs;
    this.jobs = [];
    for (const job of jobs) {
      if (this.destroyed) break;
      job.age = Math.min(job.duration, job.age + dt);
      job.frame(job.age);
      if (job.age < job.duration && !this.destroyed) this.jobs.push(job);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.jobs = [];
  }
}
