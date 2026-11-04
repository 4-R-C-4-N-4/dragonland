// Enemy commit (implementation.md §8). Picks general/loadout/formation, builds a SideSetup.
import type { AiLoadout, ClassId, GameData } from '../data';
import { uniqueName } from '../data/names';
import { createRng, nextId, pick, type Rng } from '../sim/rng';
import type { SideSetup, SquadSetup, TroopSetup } from '../sim/types';

export interface CommitResult {
  loadout: AiLoadout;
  side: SideSetup;
}

function committableLoadouts(data: GameData): AiLoadout[] {
  return data.aiLoadouts.filter((l) => !l.test);
}

function classCounts(data: GameData, loadout: AiLoadout): Partial<Record<ClassId, number>> {
  const counts: Partial<Record<ClassId, number>> = {};
  for (const sq of loadout.squads) {
    for (const u of sq.units) {
      const unit = data.unitById.get(u.unitId);
      if (!unit) continue;
      counts[unit.classId] = (counts[unit.classId] ?? 0) + u.count;
    }
  }
  return counts;
}

function classAdvantage(data: GameData, a: ClassId, b: ClassId): number {
  const defA = data.classById.get(a);
  const defB = data.classById.get(b);
  if (defA?.strongAgainst === b) return 1;
  if (defB?.strongAgainst === a) return -1;
  return 0;
}

function matchupScore(data: GameData, loadout: AiLoadout, prev: Partial<Record<ClassId, number>>): number {
  const mine = classCounts(data, loadout);
  let score = 0;
  for (const [myClass, myCount] of Object.entries(mine) as [ClassId, number][]) {
    for (const [theirClass, theirCount] of Object.entries(prev) as [ClassId, number][]) {
      score += classAdvantage(data, myClass, theirClass) * myCount * theirCount;
    }
  }
  return score;
}

const AI_SEED_SALT = 0x9e3779b9;

export function commitEnemy(data: GameData, lastPlayerComposition: Partial<Record<ClassId, number>> | null, seed: number): CommitResult {
  const candidates = committableLoadouts(data);
  if (candidates.length === 0) throw new Error('no committable AI loadouts');
  // Salted so the enemy's generated names/ids never replay the same RNG stream as a roster
  // generated from the same seed (they did: enemy troops had the player's names).
  const rng = createRng((seed ^ AI_SEED_SALT) >>> 0);

  let chosen: AiLoadout;
  if (!lastPlayerComposition) {
    chosen = pick(rng, candidates);
  } else {
    let bestScore = -Infinity;
    let best: AiLoadout[] = [];
    for (const l of candidates) {
      const s = matchupScore(data, l, lastPlayerComposition);
      if (s > bestScore) {
        bestScore = s;
        best = [l];
      } else if (s === bestScore) {
        best.push(l);
      }
    }
    chosen = best.length === 1 ? best[0]! : pick(rng, best);
  }

  const side = buildSideSetupFromLoadout(data, chosen, rng);
  return { loadout: chosen, side };
}

/** Builds a SideSetup with generated troop ids and unique names from an AiLoadout. DECISIONS D7. */
export function buildSideSetupFromLoadout(data: GameData, loadout: AiLoadout, rng: Rng): SideSetup {
  const taken = new Set<string>();
  const squads: SquadSetup[] = loadout.squads.map((sq, i) => {
    const troops: TroopSetup[] = [];
    for (const u of sq.units) {
      for (let n = 0; n < u.count; n++) {
        troops.push({ troopId: nextId(rng, 'ai'), name: uniqueName(rng, data.names, taken), unitId: u.unitId });
      }
    }
    return { id: `${loadout.id}-sq${i}`, name: sq.name, disposition: sq.disposition, troops };
  });
  return { generalId: loadout.generalId, formationId: loadout.formation, squads };
}
