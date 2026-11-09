// Muster strength: how many troops a division counts as its own. Resting refills losses up to
// it. It rises when troops join (opening army, wild recruits, adopted or joining generals) and
// falls only when a general leaves the division taking its troops; battle losses never lower it.
import type { Division, War } from './types';

function held(war: War, division: Division): number {
  return division.generals.reduce((n, id) => n + (war.generals.find(g => g.id === id)?.troops.length ?? 0), 0);
}

/** The division's muster; older saves without one count what it holds now. */
export function musterOf(war: War, division: Division): number {
  return Math.max(division.muster ?? 0, held(war, division));
}

/** Call after troops join the division: the muster becomes at least what it now holds. */
export function raiseMuster(war: War, division: Division): void {
  division.muster = musterOf(war, division);
}

/** Call before a general leaves the division taking `troops` with it. */
export function lowerMuster(war: War, division: Division, troops: number): void {
  division.muster = Math.max(0, musterOf(war, division) - troops);
}
