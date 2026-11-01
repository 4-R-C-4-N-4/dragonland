// Art-pass hook (implementation.md §10, milestone 6).
// Drop `assets/sprites/<unitId>.png` + `assets/sprites/<unitId>.json` (Aseprite "Export Sprite Sheet" JSON,
// hash or array frames, with frame tags named idle/walk/attack/hit/death) and the renderer swaps that unit's
// placeholder shape for the sheet. No code changes needed: files are discovered with import.meta.glob.
// This module is pure parsing + discovery; Pixi texture creation lives in the renderer.

export const ANIMATIONS = ['idle', 'walk', 'attack', 'hit', 'death'] as const;
export type AnimationName = (typeof ANIMATIONS)[number];

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  durationMs: number;
}

export interface SheetAnimation {
  frames: FrameRect[];
  loop: boolean;
}

export interface ParsedSheet {
  unitId: string;
  imageUrl: string;
  frameW: number;
  frameH: number;
  /** Every required animation is present; missing tags fall back to idle (or frame 0). */
  animations: Record<AnimationName, SheetAnimation>;
}

interface AseFrame {
  frame: { x: number; y: number; w: number; h: number };
  duration?: number;
  filename?: string;
}
interface AseJson {
  frames: Record<string, AseFrame> | (AseFrame & { filename?: string })[];
  meta?: { frameTags?: { name: string; from: number; to: number; direction?: string }[] };
}

const NON_LOOPING: ReadonlySet<AnimationName> = new Set(['attack', 'hit', 'death']);
const DEFAULT_FRAME_MS = 100;

function isAseJson(v: unknown): v is AseJson {
  if (typeof v !== 'object' || v === null) return false;
  const f = (v as { frames?: unknown }).frames;
  return typeof f === 'object' && f !== null;
}

/** Parse Aseprite sprite-sheet JSON. Throws on malformed input (caller logs and keeps the placeholder). */
export function parseAsepriteSheet(unitId: string, imageUrl: string, json: unknown): ParsedSheet {
  if (!isAseJson(json)) throw new Error(`sprite sheet ${unitId}: not Aseprite JSON (missing frames)`);
  const list: AseFrame[] = Array.isArray(json.frames) ? json.frames : Object.values(json.frames);
  if (list.length === 0) throw new Error(`sprite sheet ${unitId}: no frames`);
  const rects: FrameRect[] = list.map((f, i) => {
    const r = f.frame;
    if (!r || ![r.x, r.y, r.w, r.h].every((n) => typeof n === 'number')) {
      throw new Error(`sprite sheet ${unitId}: bad frame ${i}`);
    }
    return { x: r.x, y: r.y, w: r.w, h: r.h, durationMs: f.duration ?? DEFAULT_FRAME_MS };
  });

  const tags = new Map<string, FrameRect[]>();
  for (const t of json.meta?.frameTags ?? []) {
    const from = Math.max(0, t.from);
    const to = Math.min(rects.length - 1, t.to);
    if (to < from) continue;
    let frames = rects.slice(from, to + 1);
    if (t.direction === 'reverse') frames = frames.reverse();
    else if (t.direction === 'pingpong') frames = [...frames, ...frames.slice(1, -1).reverse()];
    tags.set(t.name.toLowerCase(), frames);
  }

  const fallback = tags.get('idle') ?? [rects[0]!];
  const animations = {} as Record<AnimationName, SheetAnimation>;
  for (const name of ANIMATIONS) {
    animations[name] = { frames: tags.get(name) ?? fallback, loop: !NON_LOOPING.has(name) };
  }
  const first = rects[0]!;
  return { unitId, imageUrl, frameW: first.w, frameH: first.h, animations };
}

/** Pair `<id>.json` modules with `<id>.png` urls from glob maps. Exported for tests. */
export function collectSheets(
  jsonModules: Record<string, unknown>,
  pngUrls: Record<string, string>,
  onError: (msg: string) => void = () => {},
): Map<string, ParsedSheet> {
  const byBase = (p: string) => p.replace(/^.*\//, '').replace(/\.(json|png)$/, '');
  const pngs = new Map(Object.entries(pngUrls).map(([p, url]) => [byBase(p), url] as const));
  const out = new Map<string, ParsedSheet>();
  for (const [path, mod] of Object.entries(jsonModules).sort(([a], [b]) => a.localeCompare(b))) {
    const unitId = byBase(path);
    const url = pngs.get(unitId);
    if (!url) {
      onError(`sprite sheet ${unitId}: json without matching png`);
      continue;
    }
    const json = (mod as { default?: unknown }).default ?? mod;
    try {
      out.set(unitId, parseAsepriteSheet(unitId, url, json));
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    }
  }
  return out;
}

/** Discover all sheets under /assets/sprites at build time (Vite). */
export function discoverSheets(onError?: (msg: string) => void): Map<string, ParsedSheet> {
  const jsons = import.meta.glob('../../assets/sprites/*.json', { eager: true });
  const pngs = import.meta.glob('../../assets/sprites/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
  return collectSheets(jsons, pngs, onError);
}
