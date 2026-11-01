// Render-layer colour helpers: resolve a battle's team/squad colours once per view, and pick
// readable outline/text colours against an arbitrary player-chosen background. Pure, DOM-free.
import { hexToNumber, hexToRgb, resolveSideColors, deriveSquadColor, type SideColors } from '../data/colors';
import type { BattleSetup, Side } from '../sim';

export type { SideColors };
export { hexToNumber };

/** Resolve both sides' colours once from a BattleSetup (presentation-only fields). */
export function resolveBattleColors(
  setup: BattleSetup,
  fallbackPlayer: string,
  fallbackEnemy: string,
): [SideColors, SideColors] {
  const side0 = setup.sides[0];
  const side1 = setup.sides[1];
  return [
    resolveSideColors(side0.color, side0.squads.map((s) => s.color), fallbackPlayer),
    resolveSideColors(side1.color, side1.squads.map((s) => s.color), fallbackEnemy),
  ];
}

/** Squad colour for a slot, tolerant of slots beyond the resolved array (derives a shade on the fly). */
export function squadColorFor(colors: SideColors, slot: number): string {
  return colors.squads[slot] ?? deriveSquadColor(colors.team, slot);
}

export function squadColorNumberFor(colors: SideColors, slot: number): number {
  return hexToNumber(squadColorFor(colors, slot));
}

export function teamColorNumber(colors: SideColors): number {
  return hexToNumber(colors.team);
}

/** Relative luminance (sRGB, ITU-R BT.709 coefficients) for 0..255 channels. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Pick black or white (as a Pixi colour number) for best contrast text/outline over `bgHex`. */
export function contrastMono(bgHex: string): number {
  return luminance(bgHex) > 0.42 ? 0x111111 : 0xffffff;
}

export function sideLabel(side: Side): 'player' | 'enemy' {
  return side === 0 ? 'player' : 'enemy';
}

/** Deterministic key for baking/looking up a (unit, colour) texture variant. */
export function colorTextureKey(unitId: string, colorHex: string): string {
  return `${unitId}:${colorHex.toLowerCase()}`;
}
