import { getGameData } from '../data';
import { uniqueName } from '../data/names';
import type { ProgressTroop } from '../progression';
import { internal, nextFloat, nextId } from './rng';
import type { Division, PendingBattle, War } from './types';

export type SearchOutcome = { kind: 'nothing' } | { kind: 'wild'; wild: { unitId: string; count: number }[] };

function searchableDivision(war: War, divisionId: string): { division: Division; node: War['nodes'][number] } {
  const division = war.divisions.find(d => d.id === divisionId);
  if (!division) throw new Error(`Unknown division ${divisionId}`);
  if (!division.generals.length) throw new Error(`Division ${divisionId} is empty`);
  // Any faction may search: the engine does not decide who is allowed to act.
  if (!war.factions.some(f => f.id === division.factionId)) throw new Error(`Division ${divisionId} has unknown faction ${division.factionId}`);
  const node = war.nodes.find(n => n.id === division.atNode);
  if (!node) throw new Error(`Division ${divisionId} is not at a known node`);
  const table = internal(war).data.biomes[node.biome];
  if (node.biome !== 'settled' && (!table || table.length === 0)) throw new Error(`Biome ${node.biome} has no search table`);
  return { division, node };
}

/** Resolve a search from a single seeded draw; inputs are only read. */
export function searchOutcome(war: War, divisionId: string): SearchOutcome {
  const { division, node } = searchableDivision(war, divisionId);
  void division;
  const draw = nextFloat(internal(war).rng);
  if (node.biome === 'settled') return { kind: 'nothing' };
  const table = internal(war).data.biomes[node.biome];
  if (!table?.length) throw new Error(`Biome ${node.biome} has no search table`);
  const chance = node.kind === 'lair' ? internal(war).data.constants.SEARCH_CHANCE_LAIR : internal(war).data.constants.SEARCH_CHANCE_WILD;
  if (draw >= chance) return { kind: 'nothing' };
  const totalWeight = table.reduce((sum, entry) => sum + entry.weight, 0);
  let selected = (draw / chance) * totalWeight;
  for (const entry of table) {
    selected -= entry.weight;
    if (selected < 0) return { kind: 'wild', wild: [{ unitId: entry.unitId, count: entry.count }] };
  }
  const last = table[table.length - 1]!;
  return { kind: 'wild', wild: [{ unitId: last.unitId, count: last.count }] };
}

/** Build a pending wild-battle record with replay-stable identity. */
export function wildEncounter(war: War, divisionId: string, wild: { unitId: string; count: number }[]): PendingBattle {
  const { division, node } = searchableDivision(war, divisionId);
  if (!wild.length || wild.some(entry => !Number.isInteger(entry.count) || entry.count <= 0)) throw new Error('Wild encounter requires positive troop counts');
  // The division is part of the identity: two allied divisions may search one node in one turn.
  return { id: `wild-${war.turn}-${node.id}-${division.id}`, cause: 'wild', nodeId: node.id, attacker: division.id, defender: null, wild: structuredClone(wild), processedSkirmishIds: [] };
}

/** Add defeated wild troops to a victorious general, capped by remaining capacity. */
export function applyWildVictory(war: War, divisionId: string, generalId: string, defeated: { unitId: string; count: number }[]): void {
  if (!defeated.length) return;
  const { division } = searchableDivision(war, divisionId);
  if (!division.generals.includes(generalId)) throw new Error(`General ${generalId} is not in division ${divisionId}`);
  const general = war.generals.find(g => g.id === generalId);
  if (!general) throw new Error(`Unknown general ${generalId}`);
  if (defeated.some(entry => !Number.isInteger(entry.count) || entry.count < 0 || !getGameData().unitById.has(entry.unitId))) throw new Error('Invalid defeated wild troops');
  const capacity = Math.max(0, general.capacity - general.troops.length);
  const total = defeated.reduce((sum, entry) => sum + entry.count, 0);
  const takenNames = new Set(war.generals.flatMap(g => g.troops.map(t => t.name)));
  const takenIds = new Set(war.generals.flatMap(g => g.troops.map(t => t.id)));
  const rng = internal(war).rng, names = getGameData().names;
  let remaining = Math.min(capacity, total);
  for (const entry of defeated) {
    const count = Math.min(remaining, entry.count);
    for (let i = 0; i < count; i++) {
      let id = nextId(rng, 'troop');
      while (takenIds.has(id)) id = nextId(rng, 'troop');
      takenIds.add(id);
      const troop: ProgressTroop = { id, name: uniqueName(rng, names, takenNames), unitId: entry.unitId, xp: 0, level: 1 };
      general.troops.push(troop);
    }
    remaining -= count;
    if (remaining <= 0) break;
  }
}
