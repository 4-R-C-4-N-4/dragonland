// Shared UI pieces (see docs/DESIGN.md): portraits, meters, chips and the general card, so a
// general or a troop kind looks the same on every screen.
import { getGameData } from '../../data';
import { discoverSheets, type ParsedSheet } from '../../render/spriteSheets';
import { maxMpOf, mpOf } from '../../world/mp';
import type { GeneralRecord } from '../../world/types';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let sheets: Map<string, ParsedSheet> | null = null;
const images = new Map<string, Promise<HTMLImageElement>>();
function image(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
    images.set(url, p);
  }
  return p;
}

/** Colour of the class a unit belongs to, from the game data. */
export function classColorOf(unitId: string): string {
  const data = getGameData();
  const unit = data.unitById.get(unitId);
  return (unit && data.classById.get(unit.classId)?.color) || '#556';
}

/** A unit's first idle frame, pixel-scaled onto a class-tinted plate. Stays a plain plate if the sheet is missing. */
export function portrait(unitId: string, size = 56, flip = false): HTMLCanvasElement {
  const cv = el('canvas', `dl-portrait${flip ? ' dl-portrait--flip' : ''}`);
  cv.width = 96; cv.height = 96;
  cv.style.setProperty('--size', `${size}px`);
  cv.style.setProperty('--class-color', classColorOf(unitId));
  cv.setAttribute('aria-hidden', 'true');
  try { sheets ??= discoverSheets(); } catch { sheets = new Map(); }
  const sheet = sheets.get(unitId);
  const f = sheet?.animations.idle.frames[0];
  if (sheet && f) {
    void image(sheet.imageUrl).then(img => {
      const g = cv.getContext('2d'); if (!g) return;
      g.imageSmoothingEnabled = false;
      const pad = 6, s = Math.min((cv.width - pad * 2) / f.w, (cv.height - pad * 2) / f.h);
      g.drawImage(img, f.x, f.y, f.w, f.h, (cv.width - f.w * s) / 2, cv.height - pad - f.h * s, f.w * s, f.h * s);
    }).catch(() => { /* decoration only */ });
  }
  return cv;
}

export type BarKind = 'hp' | 'mp' | 'troops' | 'foe';
/** A meter with its number printed on it. */
export function bar(kind: BarKind, value: number, max: number, label?: string): HTMLElement {
  const b = el('div', `dl-meter dl-meter--${kind}`);
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  b.style.setProperty('--v', String(frac));
  if (kind === 'hp') b.classList.toggle('is-low', frac < 0.3), b.classList.toggle('is-mid', frac >= 0.3 && frac < 0.6);
  b.append(el('i'), el('span', undefined, label ?? `${Math.round(value)} / ${Math.round(max)}`));
  b.setAttribute('role', 'img');
  b.setAttribute('aria-label', label ?? `${Math.round(value)} of ${Math.round(max)}`);
  return b;
}

export function chip(text: string, opts: { color?: string; tone?: 'own' | 'foe' | 'ember' | 'warn'; line?: boolean } = {}): HTMLElement {
  const c = el('span', `dl-chip${opts.tone ? ` dl-chip--${opts.tone}` : ''}${opts.line ? ' dl-chip--line' : ''}`, text);
  if (opts.color) c.style.setProperty('--chip', opts.color);
  return c;
}

/** Class chip for a general's kind, e.g. "Dragon" in the Beast colour. */
export function kindChip(generalId: GeneralRecord['generalId']): HTMLElement {
  const data = getGameData();
  const profile = data.generalById.get(generalId);
  return chip(profile?.name ?? generalId, { color: profile ? classColorOf(profile.unitId) : undefined });
}

export interface GeneralCardOptions {
  tone?: 'own' | 'foe';
  /** Renders the card as a button. */
  onClick?: () => void;
  /** Troops to show: a number, or false to hide. Defaults to what the general holds. */
  troops?: number | false;
  troopsLabel?: string;
  /** Extra chips after the kind chip (e.g. "Hero", "Garrison"). */
  chips?: HTMLElement[];
  note?: string;
  noteTone?: 'warn' | 'good' | 'bad';
  compact?: boolean;
  /** Greyed out: defeated or unavailable. */
  out?: boolean;
  /** Hide MP (enemy MP is not the player's business on some screens). */
  mp?: boolean;
  size?: number;
  key?: string;
}

/** Portrait, name, kind, HP/MP meters and troops for one general. */
export function generalCard(g: GeneralRecord, opts: GeneralCardOptions = {}): HTMLElement {
  const data = getGameData();
  const profile = data.generalById.get(g.generalId);
  const card = el(opts.onClick ? 'button' : 'div', `dl-gcard dl-cut${opts.tone ? ` dl-gcard--${opts.tone}` : ''}${opts.compact ? ' dl-gcard--compact' : ''}${opts.out ? ' dl-gcard--out' : ''}`);
  if (opts.onClick) { (card as HTMLButtonElement).type = 'button'; card.addEventListener('click', opts.onClick); }
  if (opts.key) card.dataset.key = opts.key;
  card.append(portrait(profile?.unitId ?? '', opts.size ?? (opts.compact ? 44 : 60), opts.tone === 'foe'));
  const name = el('div', 'dl-gcard__name');
  name.append(el('b', undefined, g.name), kindChip(g.generalId));
  if (g.isHero) name.append(chip('Hero', { tone: 'ember' }));
  if (g.injuredTurns) name.append(chip(`Injured ${g.injuredTurns}`, { tone: 'warn' }));
  for (const c of opts.chips ?? []) name.append(c);
  const bars = el('div', 'dl-gcard__bars');
  bars.append(bar('hp', g.hp, g.maxHp, `HP ${Math.round(g.hp)} / ${g.maxHp}`));
  if (opts.mp !== false) bars.append(bar('mp', mpOf(g), maxMpOf(g), `MP ${Math.floor(mpOf(g))} / ${maxMpOf(g)}`));
  card.append(name, bars);
  if (opts.troops !== false) {
    const meta = el('div', 'dl-gcard__meta');
    const n = typeof opts.troops === 'number' ? opts.troops : g.troops.length;
    const t = el('span'); t.append(el('strong', undefined, String(n)), document.createTextNode(` ${opts.troopsLabel ?? (n === 1 ? 'troop' : 'troops')}`));
    meta.append(t);
    card.append(meta);
  }
  if (opts.note) card.append(el('div', `dl-gcard__note${opts.noteTone ? ` is-${opts.noteTone}` : ''}`, opts.note));
  return card;
}

/** Troop kinds with a small portrait and a count each. */
export function troopStrip(troops: readonly { unitId: string }[], empty = 'No troops.'): HTMLElement {
  const data = getGameData();
  const strip = el('div', 'dl-troops');
  const counts = new Map<string, number>();
  for (const t of troops) counts.set(t.unitId, (counts.get(t.unitId) ?? 0) + 1);
  if (!counts.size) { strip.append(el('span', 'dl-muted', empty)); return strip; }
  for (const [unitId, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const item = el('span', 'dl-troop');
    item.append(portrait(unitId, 26), document.createTextNode(String(n)), el('small', undefined, data.unitById.get(unitId)?.name ?? unitId));
    strip.append(item);
  }
  return strip;
}

/** Kicker + title block every screen starts with. The title takes focus for screen readers. */
export function heading(kicker: string, title: string): { kicker: HTMLElement; h1: HTMLHeadingElement } {
  const k = el('p', 'dl-kicker', kicker);
  const h1 = el('h1', undefined, title); h1.tabIndex = -1;
  return { kicker: k, h1 };
}
