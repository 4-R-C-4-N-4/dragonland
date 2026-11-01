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
  const lines = [
    style.style,
    style.camera,
    `Character: ${spec.name}. ${spec.description}`,
    spec.animationNotes ? `Animation notes: ${spec.animationNotes}` : '',
    style.teamCloth,
    style.layout.text,
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
