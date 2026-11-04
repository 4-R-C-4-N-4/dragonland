import { getGameData } from '../data';
import { deriveTroopStats } from '../progression';
import { awardTroopXp, awardHeroXp, getProgressionConfig, type HeroProgress } from '../progression';
import type { BattleResult, World as SimWorld } from '../sim';
import { internal } from './rng';
import { nextFloat } from './rng';
import type { BattleSetup, SideSetup } from '../sim';
import { retreatNode } from './movement';
import type { Division, GeneralRecord, PendingBattle, War } from './types';

export interface BattleSelection {
  /** Defender first, attacker second. This is also simulation side order. */
  generalIds: [string, string];
  setup: BattleSetup;
  id: string;
}
export interface EncounterSequence {
  encounterId: string;
  attackerGeneralIds: string[];
  defenderGeneralIds: string[];
  selectedAttacker: string | null;
  selectedDefender: string | null;
  currentSkirmish: BattleSelection | null;
  usedGeneralIds: string[];
  defeatedGeneralIds: string[];
  status: 'selecting-defender' | 'selecting-attacker' | 'battling' | 'resolved';
  retreatNode: string | null;
  appliedSkirmishIds?: string[];
}
export interface TerminalBattleSnapshot { result: BattleResult; generalHp: [number, number] }
export interface SkirmishApplication { duplicate: boolean; status: EncounterSequence['status']; resolved: boolean }

/** Side 0 is the defender; side 1 is the attacker. */
export function snapshotBattleResult(world: SimWorld): TerminalBattleSnapshot {
  if (!world.result || world.phase !== 'result') throw new Error('Battle world has no terminal result');
  return { result: structuredClone(world.result), generalHp: [world.ents.hp[world.generals[0].entity]!, world.ents.hp[world.generals[1].entity]!] };
}

function division(war: War, id: string): Division {
  const found = war.divisions.find(x => x.id === id);
  if (!found) throw new Error(`Encounter division ${id} is missing`);
  return found;
}
function alive(g: GeneralRecord): boolean { return g.hp > 0 && g.injuredTurns === 0; }
function requireUnique(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate general ids`);
}
function validateGeneral(war: War, id: string, factionId: string): GeneralRecord {
  const matches = war.generals.filter(g => g.id === id);
  if (matches.length !== 1) throw new Error(matches.length ? `Duplicate general record ${id}` : `Encounter general ${id} is missing`);
  const g = matches[0]!;
  if (g.factionId !== factionId) throw new Error(`General ${id} belongs to the wrong faction`);
  const game = getGameData();
  if (!game.generalById.has(g.generalId)) throw new Error(`Missing general profile ${g.generalId}`);
  if (!Number.isFinite(g.hp) || !Number.isFinite(g.maxHp) || !Number.isFinite(g.level) || !Number.isInteger(g.level) || g.level < 1 || g.level > 12 || g.hp < 0 || g.maxHp <= 0 || g.hp > g.maxHp || !Number.isInteger(g.injuredTurns) || g.injuredTurns < 0 || !Array.isArray(g.troops) || g.troops.length > g.capacity || new Set(g.troops.map(t => t.id)).size !== g.troops.length) {
    throw new Error(`General ${id} has an invalid profile`);
  }
  for (const t of g.troops) {
    const unit = game.unitById.get(t.unitId);
    if (!unit || typeof t.id !== 'string' || !t.id || typeof t.name !== 'string' || !t.name || !Number.isInteger(t.level) || t.level < 1 || t.level > 12 || !Number.isFinite(t.xp) || t.xp < 0) throw new Error(`General ${id} has an invalid troop record`);
    deriveTroopStats(unit, t.level);
  }
  return g;
}
function validateArmy(war: War, d: Division, max: number): GeneralRecord[] {
  if (!Array.isArray(d.generals) || d.generals.length > max) throw new Error(`Division ${d.id} exceeds the ${max}-general battle limit`);
  requireUnique(d.generals, `Division ${d.id}`);
  return d.generals.map(id => validateGeneral(war, id, d.factionId));
}

/** Validates an encounter and prepares the eligible lists. No battle setup is frozen yet. */
export function sequenceEncounter(war: War, pending: PendingBattle): EncounterSequence {
  if (!war.pendingBattle || war.pendingBattle.id !== pending.id || war.pendingBattle.attacker !== pending.attacker || war.pendingBattle.defender !== pending.defender || war.pendingBattle.nodeId !== pending.nodeId) throw new Error('Pending battle does not match the war');
  if (pending.wild.length) throw new Error('Wild encounters are not supported by general sequencing');
  if (pending.defender === null && pending.cause === 'wild') throw new Error('Wild encounters are not supported by general sequencing');
  const attacker = division(war, pending.attacker);
  const defender = pending.defender ? division(war, pending.defender) : null;
  if (attacker.factionId === defender?.factionId) throw new Error('Encounter factions must be hostile');
  if (defender) requireUnique([...attacker.generals, ...defender.generals], 'Encounter armies');
  const cap = internal(war).data.constants.MAX_DIVISION_GENERALS;
  const attackers = validateArmy(war, attacker, cap).filter(alive);
  let defenders: GeneralRecord[];
  if (defender) {
    defenders = validateArmy(war, defender, cap).filter(alive);
  } else {
    const node = war.nodes.find(n => n.id === pending.nodeId);
    if (!node || node.kind !== 'castle' || !node.owner || node.owner === attacker.factionId) throw new Error('Garrison encounter requires a hostile castle');
    const assignedDivisions = war.divisions.filter(d => d.factionId === node.owner && d.atNode === node.id);
    if (assignedDivisions.some(d => d.generals.length)) throw new Error('A field division cannot be used as castle garrison');
    const assigned: string[] = [];
    const unassigned = war.generals.filter(g => g.factionId === node.owner && g.nodeId === node.id && !war.divisions.some(d => d.generals.includes(g.id))).map(g => g.id);
    const garrisonIds = [...assigned, ...unassigned];
    const garrisonCap = internal(war).data.constants.GARRISON_CAP;
    if (garrisonIds.length > garrisonCap) throw new Error(`Castle garrison exceeds the ${garrisonCap}-general battle limit`);
    requireUnique(garrisonIds, 'Castle garrison');
    defenders = garrisonIds.map(id => validateGeneral(war, id, node.owner!)).filter(alive);
  }
  requireUnique([...attackers, ...defenders].map(g => g.id), 'Encounter armies');
  if (defenders.length > internal(war).data.constants.GARRISON_CAP) throw new Error('Defender army exceeds the garrison limit');
  const sequence: EncounterSequence = {
    encounterId: pending.id,
    attackerGeneralIds: attackers.map(g => g.id),
    defenderGeneralIds: defenders.map(g => g.id),
    selectedAttacker: null, selectedDefender: null, currentSkirmish: null,
    usedGeneralIds: [], defeatedGeneralIds: [], status: 'selecting-defender',
    retreatNode: retreatNode(war, attacker),
    appliedSkirmishIds: [],
  };
  if (!sequence.attackerGeneralIds.length || !sequence.defenderGeneralIds.length) sequence.status = 'resolved';
  return sequence;
}

function commit(sequence: EncounterSequence, generalId: string, side: 'defender' | 'attacker'): void {
  if (sequence.status === 'resolved') throw new Error('Encounter is resolved');
  if (side === 'defender' && sequence.status !== 'selecting-defender') throw new Error('Defender must be selected before attacker');
  if (side === 'attacker' && sequence.status !== 'selecting-attacker') throw new Error('Select a defender first');
  const eligible = side === 'defender' ? sequence.defenderGeneralIds : sequence.attackerGeneralIds;
  if (!eligible.includes(generalId) || sequence.defeatedGeneralIds.includes(generalId) || sequence.usedGeneralIds.includes(generalId)) throw new Error(`General ${generalId} is not eligible`);
}
function buildSide(g: GeneralRecord, sideIndex: 0 | 1): SideSetup {
  const game = getGameData();
  const profile = game.generalById.get(g.generalId);
  const formationId = game.formations[0]?.id;
  if (!profile || !formationId) throw new Error(!profile ? `Missing general profile ${g.generalId}` : 'No battle formation is available');
  const grouped = new Map<string, typeof g.troops>();
  for (const troop of g.troops) (grouped.get(troop.unitId) ?? grouped.set(troop.unitId, []).get(troop.unitId)!).push(troop);
  const squads = [...grouped.entries()].map(([unitId, troops], index) => ({
    id: `side${sideIndex}-${g.id}-squad${index}`, name: game.unitById.get(unitId)!.name, disposition: 'mixed' as const,
    troops: troops.map(t => ({ troopId: t.id, name: t.name, unitId: t.unitId, statMult: deriveTroopStats(game.unitById.get(t.unitId)!, t.level).damageMultiplier })),
  }));
  return { generalId: g.generalId, formationId, general: { ...profile, hp: Math.max(1, g.hp), level: g.level }, squads };
}
function makeSkirmish(war: War, defender: GeneralRecord, attacker: GeneralRecord): BattleSelection {
  const game = getGameData();
  return {
    id: `${war.pendingBattle!.id}-skirmish-${war.pendingBattle!.processedSkirmishIds.length + 1}`,
    generalIds: [defender.id, attacker.id],
    setup: { seed: (war.seed ^ hash(`${war.pendingBattle!.id}:${war.pendingBattle!.processedSkirmishIds.length}`)) >>> 0, sides: [buildSide(defender, 0), buildSide(attacker, 1)] },
  };
}
export function commitDefender(war: War, sequence: EncounterSequence, generalId: string): BattleSelection | null {
  if (!war.pendingBattle || war.pendingBattle.id !== sequence.encounterId) throw new Error('Sequence does not match the pending encounter');
  commit(sequence, generalId, 'defender');
  const defender = war.generals.find(g => g.id === generalId)!;
  if (!alive(defender) || !sequence.defenderGeneralIds.includes(generalId) || (war.pendingBattle!.defender && !division(war, war.pendingBattle!.defender).generals.includes(generalId)) || (!war.pendingBattle!.defender && war.divisions.some(d => d.generals.includes(generalId)))) throw new Error('Selected general is no longer eligible');
  sequence.selectedDefender = generalId;
  sequence.status = 'selecting-attacker';
  // No setup is made until the attacker is committed.
  void defender;
  return null;
}
export function commitAttacker(war: War, sequence: EncounterSequence, generalId: string): BattleSelection {
  if (!war.pendingBattle || war.pendingBattle.id !== sequence.encounterId) throw new Error('Sequence does not match the pending encounter');
  commit(sequence, generalId, 'attacker');
  const defender = war.generals.find(g => g.id === sequence.selectedDefender);
  const attacker = war.generals.find(g => g.id === generalId);
  const pending = war.pendingBattle!;
  if (!defender || !attacker || !alive(defender) || !alive(attacker) || !sequence.defenderGeneralIds.includes(defender.id) || !sequence.attackerGeneralIds.includes(attacker.id) || !division(war, pending.attacker).generals.includes(attacker.id) || (pending.defender && !division(war, pending.defender).generals.includes(defender.id))) throw new Error('Selected general is no longer eligible');
  const skirmish = makeSkirmish(war, defender, attacker);
  sequence.selectedAttacker = generalId;
  sequence.currentSkirmish = skirmish;
  sequence.usedGeneralIds = [...new Set([...sequence.usedGeneralIds, defender.id, attacker.id])];
  sequence.status = 'battling';
  return skirmish;
}

function validSnapshot(war: War, sequence: EncounterSequence, skirmish: BattleSelection, snapshot: TerminalBattleSnapshot): void {
  const result = snapshot?.result;
  if (!result || ![0,1].includes(result.winner) || !Number.isFinite(result.durationS) || result.durationS < 0 || typeof result.hadDuel !== 'boolean' || !['generalDefeated','duel'].includes(result.reason)) throw new Error('Malformed terminal battle result');
  if (!Array.isArray(snapshot.generalHp) || snapshot.generalHp.length !== 2) throw new Error('Malformed terminal general HP');
  const records = skirmish.generalIds.map(id => war.generals.find(g => g.id === id));
  if (records.some((g): g is undefined => !g)) throw new Error('Skirmish general is missing');
  const frozenIds = skirmish.setup.sides.map(side => side.squads.flatMap(s => s.troops.map(t => t.troopId)));
  const frozenHp = skirmish.setup.sides.map(side => side.general?.hp);
  for (const side of [0,1] as const) {
    const g = records[side]!;
    if (frozenHp[side] === undefined || skirmish.setup.sides[side]!.generalId !== g.generalId || g.hp !== frozenHp[side] || g.troops.map(t => t.id).sort().join('\0') !== [...frozenIds[side]!].sort().join('\0')) throw new Error('Skirmish roster changed after setup');
  }
  if (snapshot.generalHp.some((hp, i) => !Number.isFinite(hp) || hp < 0 || hp > frozenHp[i]!)) throw new Error('Illegal terminal general HP');
  if (snapshot.generalHp[result.winner] <= 0 || (result.reason === 'generalDefeated' && snapshot.generalHp[result.winner === 0 ? 1 : 0] !== 0)) throw new Error('Terminal general HP does not match result');
  if (!Array.isArray(result.dead) || !Array.isArray(result.survivors) || result.dead.length !== 2 || result.survivors.length !== 2) throw new Error('Malformed troop identity partition');
  for (const side of [0,1] as const) {
    const expected = frozenIds[side]!;
    const dead = result.dead[side], survivors = result.survivors[side];
    if (!Array.isArray(dead) || !Array.isArray(survivors) || [...dead, ...survivors].some(id => typeof id !== 'string') || new Set([...dead, ...survivors]).size !== dead.length + survivors.length || [...dead, ...survivors].length !== expected.length || expected.some(id => !dead.includes(id) && !survivors.includes(id)) || [...dead, ...survivors].some(id => !expected.includes(id))) throw new Error('Troop identity partition does not match frozen troops');
  }
}
function resolveDivision(war: War, sequence: EncounterSequence, divisionId: string, winnerSide: 0 | 1): boolean {
  const d = war.divisions.find(x => x.id === divisionId);
  if (!d) return false;
  const ids = d.generals.filter(id => !sequence.defeatedGeneralIds.includes(id) && alive(war.generals.find(g => g.id === id)!));
  if (ids.length) return false;
  const fallback = retreatNode(war, d);
  if (fallback) {
    const from = d.atNode; d.atNode = fallback; d.previousNode = from;
    const paths = internal(war).paths; (paths[d.id] ??= []).push(from);
    for (const g of war.generals.filter(g => d.generals.includes(g.id))) g.nodeId = fallback;
    war.events.push({ type: 'retreated', division: d.id, toNode: fallback });
  }
  void winnerSide;
  return true;
}
export function applySkirmishResult(war: War, sequence: EncounterSequence, skirmishId: string, snapshot: TerminalBattleSnapshot): SkirmishApplication {
  const pending = war.pendingBattle;
  if (pending?.id !== sequence.encounterId && !(sequence.status === 'resolved' && sequence.encounterId && pending === null)) throw new Error('Sequence does not match pending encounter');
  if (pending?.processedSkirmishIds.includes(skirmishId) || sequence.appliedSkirmishIds?.includes(skirmishId)) return { duplicate: true, status: sequence.status, resolved: sequence.status === 'resolved' };
  const skirmish = sequence.currentSkirmish;
  if (!pending || sequence.status !== 'battling' || !skirmish || skirmish.id !== skirmishId) throw new Error('Result is out of order or does not match current skirmish');
  validSnapshot(war, sequence, skirmish, snapshot);
  const result = snapshot.result;
  const currentIds = skirmish.generalIds;
  const records = currentIds.map(id => war.generals.find(g => g.id === id)!);
  // All validation is complete before state changes.
  for (const side of [0,1] as const) {
    const g = records[side]!; g.hp = snapshot.generalHp[side];
    g.troops = g.troops.filter(t => result.survivors[side].includes(t.id));
    if (side === result.winner) {
      const xp = getProgressionConfig().troop.xpPerVictory;
      const unitById = Object.fromEntries([...getGameData().unitById].map(([id,u])=>[id,u]));
      g.troops = g.troops.map(t => awardTroopXp(t, xp, unitById));
    }
    if (side === result.winner && g.isHero) {
      const hero: HeroProgress = { generalId: g.generalId, xp: g.xp, level: g.level, upgrades: { vitality:0,might:0,mastery:0 }, claimedMilestones:[] };
      const advanced = awardHeroXp(hero, getProgressionConfig().hero.xpPerVictory); g.xp = advanced.xp; g.level = advanced.level;
    }
  }
  const loser = records[result.winner === 0 ? 1 : 0]!;
  if (loser.hp <= 0) {
    sequence.defeatedGeneralIds.push(loser.id);
    const losingDivision = war.divisions.find(d => d.generals.includes(loser.id));
    if (losingDivision) losingDivision.generals = losingDivision.generals.filter(id => id !== loser.id);
    if (loser.isHero) { war.phase = 'lost'; sequence.status = 'resolved'; }
    else {
      const constants = internal(war).data.constants;
      const roll = nextFloat(internal(war).rng), capture = constants.CAPTURE_WEIGHT, injure = capture + constants.INJURE_WEIGHT;
      if (roll < capture) {
        const captor = war.factions.find(f => f.id === records[result.winner]!.factionId)!;
        if (!captor.captives.includes(loser.id)) captor.captives.push(loser.id);
        loser.nodeId = records[result.winner]!.nodeId;
      } else if (roll < injure) { loser.injuredTurns = constants.INJURY_TURNS; }
      else { loser.hp = 0; }
    }
  }
  pending.processedSkirmishIds.push(skirmishId);
  (sequence.appliedSkirmishIds ??= []).push(skirmishId);
  sequence.selectedAttacker = null; sequence.selectedDefender = null; sequence.currentSkirmish = null;
  if (war.phase === 'lost') { sequence.status = 'resolved'; war.pendingBattle = null; return { duplicate: false, status: sequence.status, resolved: true }; }
  const attackerDone = resolveDivision(war, sequence, pending.attacker, result.winner);
  const defenderDone = pending.defender ? resolveDivision(war, sequence, pending.defender, result.winner) : false;
  const attackerRemaining = sequence.attackerGeneralIds.some(id => alive(war.generals.find(g=>g.id===id)!) && !sequence.defeatedGeneralIds.includes(id));
  const defenderRemaining = sequence.defenderGeneralIds.some(id => alive(war.generals.find(g=>g.id===id)!) && !sequence.defeatedGeneralIds.includes(id));
  if (!attackerRemaining || !defenderRemaining || attackerDone || (pending.defender && defenderDone)) {
    sequence.status = 'resolved'; war.pendingBattle = null;
    if (pending.defender === null) {
      const node = war.nodes.find(n => n.id === pending.nodeId)!;
      node.owner = !attackerRemaining ? node.owner : division(war, pending.attacker).factionId;
    }
  } else {
    sequence.status = 'selecting-defender';
    sequence.usedGeneralIds = sequence.usedGeneralIds.filter(id => sequence.defeatedGeneralIds.includes(id));
  }
  return { duplicate: false, status: sequence.status, resolved: sequence.status === 'resolved' };
}

export function retreatEncounter(war: War, sequence: EncounterSequence, divisionId: string): { resolved: true } {
  if (!war.pendingBattle || war.pendingBattle.id !== sequence.encounterId || sequence.status === 'battling' || sequence.status === 'resolved') throw new Error('Retreat is only available between skirmishes');
  const d = war.divisions.find(x => x.id === divisionId);
  if (!d || (divisionId !== war.pendingBattle.attacker && divisionId !== war.pendingBattle.defender)) throw new Error('Division is not in this encounter');
  const fallback = retreatNode(war, d);
  if (!fallback || fallback === d.atNode || !war.nodes.some(n => n.id === fallback)) throw new Error('No legal previous-node retreat');
  const from = d.atNode; d.atNode = fallback; d.previousNode = from;
  (internal(war).paths[d.id] ??= []).push(from);
  for (const g of war.generals.filter(g => d.generals.includes(g.id))) g.nodeId = fallback;
  war.events.push({ type: 'retreated', division: d.id, toNode: fallback });
  sequence.status = 'resolved'; war.pendingBattle = null;
  return { resolved: true };
}
function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
