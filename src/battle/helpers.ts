// Pure helpers used by the renderer/HUD — kept side-effect free for unit tests.

/** Linear interpolation between a previous and current value by alpha in [0,1]. */
export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

/** Formats seconds as mm:ss, clamped to >= 0. */
export function formatTimer(remainingS: number): string {
  const s = Math.max(0, Math.round(remainingS));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Chooses which placeholder/sheet animation a unit should play from its render state. */
export type AnimState = 'idle' | 'walk' | 'attack' | 'hit' | 'death';

export interface AnimInput {
  alive: boolean;
  speed: number; // current velocity magnitude
  recentAttack: boolean;
  recentHit: boolean;
  dying: boolean;
}

export function pickAnimation(input: AnimInput): AnimState {
  if (input.dying || !input.alive) return 'death';
  if (input.recentAttack) return 'attack';
  if (input.recentHit) return 'hit';
  if (input.speed > 1) return 'walk';
  return 'idle';
}
