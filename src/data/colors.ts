// Team / squad colours (presentation). Pure, DOM-free; shared by the builder, flow and renderer.
// Ivy: class colours can't identify sides (both sides field both classes, generals may share a class),
// so each side has a player-chosen team colour and each squad a colour (explicit or a derived shade).

/** Curated team colours: saturated, distinct from each other and readable on the green field. */
export const TEAM_PALETTE: readonly string[] = [
  '#3a7bd5', // blue
  '#d5423a', // red
  '#e0b030', // gold
  '#8a4fd8', // violet
  '#1fb5a8', // teal
  '#e8742a', // orange
  '#d23f9a', // magenta
  '#e6e9ef', // silver
  '#30303a', // charcoal
];

export const DEFAULT_PLAYER_COLOR = '#3a7bd5';
export const DEFAULT_ENEMY_COLOR = '#d5423a';
/** Minimum perceptual distance (CIE76 ΔE) for two sides' colours to count as distinguishable. */
export const MIN_SIDE_DELTA_E = 45;

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad colour ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hexToNumber(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (r << 16) | (g << 8) | b;
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function rgbToLab([r, g, b]: Rgb): [number, number, number] {
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** CIE76 perceptual distance. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = rgbToLab(hexToRgb(a));
  const [l2, a2, b2] = rgbToLab(hexToRgb(b));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Squad shades of a team colour: same family, distinguishable from each other.
 * Squad i of 4 gets a hue/lightness offset; slot 0 is the team colour itself.
 */
export function deriveSquadColor(team: string, slot: number): string {
  const OFFSETS: [number, number][] = [
    [0, 0],
    [16, 0.14],
    [-16, -0.12],
    [8, 0.26],
  ];
  const [dh, dl] = OFFSETS[slot % OFFSETS.length]!;
  const [h, s, l] = rgbToHsl(hexToRgb(team));
  // Keep lightness readable; very dark/light team colours shift the other way.
  let nl = l + dl;
  if (nl > 0.85 || nl < 0.18) nl = l - dl;
  return rgbToHex(hslToRgb(h + dh, Math.min(1, s * 1.05), Math.max(0.12, Math.min(0.88, nl))));
}

export interface SideColors {
  team: string;
  squads: string[];
}

/** Resolve colours for one side: explicit squad colours win, otherwise derived shades. */
export function resolveSideColors(team: string | undefined, squadColors: (string | undefined)[], fallbackTeam: string): SideColors {
  const t = team ?? fallbackTeam;
  return { team: t, squads: squadColors.map((c, i) => c ?? deriveSquadColor(t, i)) };
}

function minDistance(color: string, others: readonly string[]): number {
  return others.length ? Math.min(...others.map((o) => deltaE(color, o))) : Infinity;
}

/**
 * Choose the enemy team colour: its preferred colour if it is far enough from every player colour
 * (team + squads), otherwise the palette colour that is furthest from all of them.
 */
export function pickEnemyTeamColor(playerColors: readonly string[], preferred?: string): string {
  if (preferred && minDistance(preferred, playerColors) >= MIN_SIDE_DELTA_E) return preferred;
  let best = DEFAULT_ENEMY_COLOR;
  let bestD = -1;
  for (const c of TEAM_PALETTE) {
    const d = minDistance(c, playerColors);
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
