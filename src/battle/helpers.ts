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

/** Sheet animation state for one sprite (art-pass units). */
export interface AnimTrack {
  anim: AnimState;
  /** ms left before a one-shot (attack / hit) may be interrupted by locomotion. */
  lockMs: number;
}

export interface AnimStepInput {
  dtMs: number;
  /** Current speed as a fraction of the unit's move speed. */
  speedFrac: number;
  attacked: boolean; // attack event this frame
  hit: boolean; // took a hit this frame
  /** Full duration of each one-shot animation, ms. */
  attackMs: number;
  hitMs: number;
}

/** Hysteresis thresholds: start walking above WALK_ON, stop below WALK_OFF (avoids flicker from crowd jostle). */
export const WALK_ON = 0.3;
export const WALK_OFF = 0.12;

/**
 * Advance the animation state machine. One-shots (attack, hit) play to completion instead of being
 * cut after a flash; walk/idle switch with hysteresis; `restart` says whether to rewind to frame 0.
 * Returning to the same locomotion animation never restarts it (that made walk cycles stutter).
 */
export function stepAnim(t: AnimTrack, i: AnimStepInput): { track: AnimTrack; restart: boolean; rate: number } {
  const rate = (anim: AnimState) => (anim === 'walk' ? Math.min(1.4, Math.max(0.6, i.speedFrac)) : 1);
  if (i.attacked) return { track: { anim: 'attack', lockMs: i.attackMs }, restart: true, rate: 1 };
  if (i.hit && !(t.anim === 'attack' && t.lockMs > 0) && !(t.anim === 'hit' && t.lockMs > 0)) {
    return { track: { anim: 'hit', lockMs: i.hitMs }, restart: true, rate: 1 };
  }
  if (t.lockMs > 0) {
    const lockMs = t.lockMs - i.dtMs;
    if (lockMs > 0) return { track: { anim: t.anim, lockMs }, restart: false, rate: 1 };
  }
  const walking = t.anim === 'walk' ? i.speedFrac > WALK_OFF : i.speedFrac > WALK_ON;
  const anim: AnimState = walking ? 'walk' : 'idle';
  return { track: { anim, lockMs: 0 }, restart: anim !== t.anim, rate: rate(anim) };
}
