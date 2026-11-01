// Art pipeline config + prompt building. See docs/art-pipeline.md.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';

export const ROOT = resolve(import.meta.dirname, '../..');
export const ART = join(ROOT, 'art');
export const RAW = join(ART, 'raw');
export const CACHE = join(ART, '.cache');
export const OUT = join(ROOT, 'assets', 'sprites');

export const ANIMS = ['idle', 'walk', 'attack', 'hit', 'death'] as const;
export type Anim = (typeof ANIMS)[number];

export interface Style {
  style: string;
  camera: string;
  background: string;
  teamCloth: string;
  layout: { rows: Anim[]; framesPerRow: number; text: string };
  /** Per-animation descriptions; also used for single-animation regeneration. */
  animations?: Partial<Record<Anim, { frames: number; text: string; layout: string }>>;
  anchor: string;
}
export interface Sizes {
  height: Record<string, number>;
  frameMs: Record<Anim, number>;
  alphaCut: number;
  outline?: string | null;
}
export interface UnitSpec {
  id: string;
  name: string;
  size: string;
  description: string;
  animationNotes?: string;
  evolvesFrom?: string;
  /** Multiplier on the size-class height (quadrupeds and birds are shorter than a standing human). */
  heightScale?: number;
  walkNotes?: string;
}

function readYaml<T>(path: string): T {
  return parse(readFileSync(path, 'utf8')) as T;
}

export const loadStyle = () => readYaml<Style>(join(ART, 'style.yaml'));
export const loadSizes = () => readYaml<Sizes>(join(ART, 'sizes.yaml'));
export const loadBatches = () => readYaml<Record<string, string[]>>(join(ART, 'batches.yaml'));

export function loadPicks(): Record<string, string> {
  return (readYaml<Record<string, string> | null>(join(ART, 'picks.yaml')) ?? {}) as Record<string, string>;
}

export function savePicks(picks: Record<string, string>): void {
  const sorted = Object.fromEntries(Object.entries(picks).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    join(ART, 'picks.yaml'),
    '# assetId -> raw file chosen for the game (relative to art/raw/<assetId>/).\n' +
      '# Set by `npm run art -- pick <assetId> <file>` or by hand.\n' +
      (Object.keys(sorted).length ? stringify(sorted) : '{}\n'),
  );
}

export function listUnits(): string[] {
  return readdirSync(join(ART, 'units'))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''))
    .sort();
}

export function loadUnit(id: string): UnitSpec {
  const p = join(ART, 'units', `${id}.yaml`);
  if (!existsSync(p)) throw new Error(`no spec art/units/${id}.yaml`);
  return { id, ...readYaml<Omit<UnitSpec, 'id'>>(p) };
}

export function rawDir(id: string): string {
  return join(RAW, id);
}

export function listRaw(id: string): string[] {
  const d = rawDir(id);
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.png')).sort() : [];
}

/** Reference images attached to a generation: the style anchor and the previous evolution stage. */
export function referencesFor(spec: UnitSpec, style: Style, picks: Record<string, string>): { role: string; path: string }[] {
  const refs: { role: string; path: string }[] = [];
  const add = (role: string, id: string) => {
    const pick = picks[id];
    if (pick) refs.push({ role, path: join(rawDir(id), pick) });
  };
  if (spec.id !== style.anchor) add('style', style.anchor);
  if (spec.evolvesFrom) add('evolution', spec.evolvesFrom);
  return refs;
}

export function buildPrompt(spec: UnitSpec, style: Style, refs: { role: string }[]): string {
  const walk = style.animations?.walk;
  const lines = [
    style.style,
    style.camera,
    `Character: ${spec.name}. ${spec.description}`,
    spec.animationNotes ? `Animation notes: ${spec.animationNotes}` : '',
    style.teamCloth,
    style.layout.text,
    walk ? `Movement quality: exaggerated, clearly different poses readable at 32 pixels tall; stay in place within each cell. Row 2 has exactly ${style.layout.framesPerRow} frames, NOT the six-frame layout used for separate walk strips. Bipeds: near leg forward contact, far knee raised passing, far leg forward contact, near knee raised passing; distinguish near and far legs with shading, swing arms opposite the legs. Quadrupeds: extended diagonal pair, tucked passing, opposite diagonal pair extended, tucked passing; keep all four legs readable. Fliers: wings fully raised, halfway down, fully lowered, halfway up, with slight body bob. Do not repeat nearly identical poses.` : '',
    spec.walkNotes ? `Walk notes for this character: ${spec.walkNotes}` : '',
    style.background,
  ];
  if (refs.some((r) => r.role === 'style'))
    lines.push('An attached reference sheet shows the established art style: match its pixel density, outline, palette treatment, lighting, cell layout and character scale exactly (a different character).');
  if (refs.some((r) => r.role === 'evolution'))
    lines.push('Another attached sheet shows the previous evolution stage of this character: keep its silhouette, pose language and colour scheme recognisable, but make this one bigger, more armoured and more detailed.');
  return lines.filter(Boolean).join('\n');
}

/** Short content hash of everything that determines a generation. Changes => asset is stale. */
export function specHash(prompt: string, refs: { path: string }[]): string {
  const h = createHash('sha256').update(prompt);
  for (const r of refs) h.update(readFileSync(r.path));
  return h.digest('hex').slice(0, 8);
}

/** Asset key for a single-animation override, e.g. "soldier.walk" in picks.yaml and art/raw/soldier/walk/. */
export const animKey = (id: string, anim: Anim) => `${id}.${anim}`;
export const animRawDir = (id: string, anim: Anim) => join(rawDir(id), anim);

export function listAnimRaw(id: string, anim: Anim): string[] {
  const d = animRawDir(id, anim);
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.png')).sort() : [];
}

/**
 * Prompt for regenerating ONE animation of an already-picked character. The picked full sheet is
 * attached so the design is copied exactly; only the new strip is generated.
 */
export function buildAnimPrompt(spec: UnitSpec, style: Style, anim: Anim): string {
  const a = style.animations?.[anim];
  if (!a) throw new Error(`style.yaml has no animations.${anim} section`);
  const notes = anim === 'walk' ? spec.walkNotes : undefined;
  return [
    style.style,
    style.camera,
    `Character: ${spec.name}. ${spec.description}`,
    'The attached sprite sheet is the approved design of THIS exact character: copy its design, colours, proportions, outline, pixel density and scale exactly. Draw only the new animation described below.',
    `Animation: ${anim}. ${notes ?? a.text}`,
    'Every frame must advance one continuous cycle. Keep the character facing RIGHT, body scale and cell anchor fixed. Preserve limb identity and weapon grips; use lighter near limbs and darker far limbs so opposite steps do not look like duplicated poses.',
    style.teamCloth,
    a.layout.replace('{frames}', String(a.frames)),
    style.background,
  ]
    .filter(Boolean)
    .join('\n');
}
