// General MP carried across battles (Dragon Force style). Battles start from the stored MP and
// MP still charges during the fight; what is left is stored again. Resting refills it.
import { getGameData } from '../data';
import type { GeneralRecord } from './types';

export function maxMpOf(g: GeneralRecord): number {
  return getGameData().generalById.get(g.generalId)?.mp ?? 0;
}

/** Stored MP, clamped to the profile's maximum; absent means full. */
export function mpOf(g: GeneralRecord): number {
  const max = maxMpOf(g);
  return Math.min(max, Math.max(0, g.mp ?? max));
}

/** Store MP from a finished battle. Ignores missing or malformed values. */
export function storeMp(g: GeneralRecord, mp: number | undefined): void {
  if (typeof mp === 'number' && Number.isFinite(mp)) g.mp = Math.min(maxMpOf(g), Math.max(0, mp));
}
