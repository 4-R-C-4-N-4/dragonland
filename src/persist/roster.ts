// Generates the player's starting roster. Pure, deterministic per seed.
import type { GameData } from '../data';
import type { Troop } from '../data/schemas';
import { createRng, nextId } from '../sim/rng';
import { uniqueName } from '../data/names';

/** All units eligible for roster troops: stage 1 and 2 only (never stage 3, D12). */
export function rosterEligibleUnitIds(data: GameData): string[] {
  return data.units.filter((u: GameData['units'][number]) => u.stage !== 3).map((u: GameData['units'][number]) => u.id);
}

/**
 * Generates data.constants.ROSTER_SIZE troops spread evenly across every stage-1/2 unit,
 * with enough of each unit that a 100-troop (MAX_COMPANY) company can be filled with
 * choices left over. Deterministic for a given seed.
 */
export function generateRoster(data: GameData, seed: number): Troop[] {
  const unitIds = rosterEligibleUnitIds(data);
  if (unitIds.length === 0) throw new Error('no stage-1/2 units in game data');
  const size = data.constants.ROSTER_SIZE;
  const rng = createRng(seed);
  const taken = new Set<string>();
  const troops: Troop[] = [];

  const base = Math.floor(size / unitIds.length);
  let remainder = size - base * unitIds.length;

  for (const unitId of unitIds) {
    let count = base;
    if (remainder > 0) {
      count++;
      remainder--;
    }
    for (let i = 0; i < count; i++) {
      const name = uniqueName(rng, data.names, taken);
      const id = nextId(rng, 'troop');
      troops.push({ id, name, unitId });
    }
  }
  return troops;
}

/**
 * Fresh named troops for the given units (demo auto-recruit, DECISIONS D20). Names are unique
 * against `existing`; deterministic for a given seed.
 */
export function recruitTroops(data: GameData, existing: Troop[], needs: Record<string, number>, seed: number): Troop[] {
  const rng = createRng(seed);
  const taken = new Set(existing.map((t) => t.name));
  const out: Troop[] = [];
  for (const [unitId, count] of Object.entries(needs).sort(([a], [b]) => a.localeCompare(b))) {
    const unit = data.unitById.get(unitId);
    if (!unit || unit.stage === 3) continue;
    for (let i = 0; i < count; i++) out.push({ id: nextId(rng, 'troop'), name: uniqueName(rng, data.names, taken), unitId });
  }
  return out;
}
