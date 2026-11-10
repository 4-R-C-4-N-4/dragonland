import { getGameData } from '../data';
import { armySide, validateArmy, type WarArmy } from './army';
import { uniqueName } from '../data/names';
import { deriveTroopStats, type ProgressTroop } from '../progression';
import type { BattleSetup, BattleResult, SideSetup } from '../sim';
import { retreatNode } from './movement';
import { raiseMuster } from './muster';
import { storeMp } from './mp';
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
  // Recruits join the division's pool: the fighter first, then any general with room.
  const members = [general, ...division.generals.filter(id => id !== generalId).map(id => war.generals.find(g => g.id === id)!).filter(Boolean)];
  const room = () => members.find(m => m.troops.length < m.capacity);
  const capacity = members.reduce((n, m) => n + Math.max(0, m.capacity - m.troops.length), 0);
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
      room()!.troops.push(troop);
    }
    remaining -= count;
    if (remaining <= 0) break;
  }
  raiseMuster(war, division);
}

export interface WildSelection {
  encounterId: string;
  divisionId: string;
  generalId: string;
  wild: { unitId: string; count: number }[];
  setup: BattleSetup;
}

/**
 * A wild pack is led by its own line's apex: walk the species' evolution chain and use the
 * general profile for that stage-3 form. Nothing is invented, so a pack of dogs is led by
 * the warg that dogs actually grow into.
 */
export function wildLeaderFor(unitId: string): { generalId: string; apexUnitId: string } {
  const game = getGameData();
  let unit = game.unitById.get(unitId);
  if (!unit) throw new Error(`Unknown wild species ${unitId}`);
  const seen = new Set<string>([unit.id]);
  while (unit.evolvesTo) {
    const next = game.unitById.get(unit.evolvesTo);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    unit = next;
  }
  const leader = game.generals.find(g => g.unitId === unit!.id);
  if (!leader) throw new Error(`No pack leader profile for ${unitId} (apex ${unit.id})`);
  return { generalId: leader.id, apexUnitId: unit.id };
}

function wildSide(wild: { unitId: string; count: number }[]): SideSetup {
  const game = getGameData();
  const formationId = game.formations[0]?.id;
  if (!formationId) throw new Error('No battle formation is available');
  if (!wild.length) throw new Error('A wild encounter needs at least one pack');
  const leader = wildLeaderFor(wild[0]!.unitId);
  const profile = game.generalById.get(leader.generalId as Parameters<typeof game.generalById.get>[0])!;
  const squads = wild.map((pack, index) => {
    const unit = game.unitById.get(pack.unitId);
    if (!unit) throw new Error(`Unknown wild species ${pack.unitId}`);
    return {
      id: `wild-squad${index}`,
      name: unit.name,
      disposition: 'mixed' as const,
      troops: Array.from({ length: pack.count }, (_, i) => ({
        troopId: `wild-${pack.unitId}-${index}-${i}`,
        name: `Wild ${unit.name} ${i + 1}`,
        unitId: pack.unitId,
        statMult: deriveTroopStats(unit, 1).damageMultiplier,
      })),
    };
  });
  return { generalId: profile.id, formationId, general: profile, squads };
}

/** Sim side of the searching general in a wild fight; the pack is the other side. */
export const WILD_SEARCHER_SIDE = 1 as const;

/** Freeze the wild fight: the pack defends (side 0), the searching general attacks (side 1). */
/** `army` is the player's prepared plan from the division pool; without one the general fights with what it holds. */
export function wildBattleSetup(war: War, divisionId: string, generalId: string, army?: WarArmy): WildSelection {
  const pending = war.pendingBattle;
  if (!pending || pending.cause !== 'wild' || pending.defender !== null) throw new Error('No wild encounter is pending');
  if (pending.attacker !== divisionId) throw new Error(`Division ${divisionId} is not the searching division`);
  const { division } = searchableDivision(war, divisionId);
  if (!division.generals.includes(generalId)) throw new Error(`General ${generalId} is not in division ${divisionId}`);
  const general = war.generals.find(g => g.id === generalId);
  if (!general) throw new Error(`Unknown general ${generalId}`);
  if (general.hp <= 0 || general.injuredTurns > 0) throw new Error(`General ${generalId} cannot fight`);
  if (army) validateArmy(war, generalId, army);
  const ours: SideSetup = armySide(war, general, WILD_SEARCHER_SIDE, army ?? null);
  return {
    encounterId: pending.id,
    divisionId,
    generalId,
    wild: pending.wild.map(w => ({ ...w })),
    setup: { seed: (war.seed ^ hashText(pending.id)) >>> 0, sides: [wildSide(pending.wild), ours] },
  };
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/**
 * Apply a finished wild fight once. A win recruits the defeated pack up to capacity; a loss
 * sends the division back along its own arrival path and recruits nothing.
 */
export function applyWildResult(war: War, selection: WildSelection, snapshot: { result: BattleResult; generalHp: [number, number]; generalMp?: [number, number] }): { applied: boolean; won: boolean } {
  const pending = war.pendingBattle;
  if (!pending || pending.id !== selection.encounterId) return { applied: false, won: false };
  if (pending.processedSkirmishIds.includes(selection.encounterId)) return { applied: false, won: false };
  const result = snapshot.result;
  if (![0, 1].includes(result.winner)) throw new Error('Malformed wild battle result');
  const general = war.generals.find(g => g.id === selection.generalId);
  const division = war.divisions.find(d => d.id === selection.divisionId);
  if (!general || !division) throw new Error('Wild encounter references a missing general or division');
  const survivors = new Set(result.survivors[1] ?? []);
  const frozen = new Set(selection.setup.sides[1].squads.flatMap(q => q.troops.map(t => t.troopId)));
  for (const id of survivors) if (!frozen.has(id)) throw new Error('Wild battle result names a troop that did not fight');
  if (!Number.isFinite(snapshot.generalHp[1]) || snapshot.generalHp[1] < 0 || snapshot.generalHp[1] > general.maxHp) throw new Error('Illegal terminal general HP');

  // Validation is complete; now mutate.
  // Benched troops did not fight; only deployed troops can die.
  general.troops = general.troops.filter(t => !frozen.has(t.id) || survivors.has(t.id));
  general.hp = snapshot.generalHp[1];
  storeMp(general, snapshot.generalMp?.[1]);
  const won = result.winner === 1;
  if (won) applyWildVictory(war, selection.divisionId, selection.generalId, selection.wild);
  else {
    const fallback = retreatNode(war, division);
    if (fallback) {
      const from = division.atNode;
      division.atNode = fallback;
      division.previousNode = from;
      (internal(war).paths[division.id] ??= []).push(from);
      for (const g of war.generals.filter(x => division.generals.includes(x.id))) g.nodeId = fallback;
      war.events.push({ type: 'retreated', division: division.id, toNode: fallback });
    }
  }
  pending.processedSkirmishIds.push(selection.encounterId);
  war.pendingBattle = null;
  if (general.isHero && general.hp <= 0) war.phase = 'lost';
  return { applied: true, won };
}
