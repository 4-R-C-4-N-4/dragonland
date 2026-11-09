// Division troop pools and prepared armies. Troop records live on generals (saves, upkeep and
// the AI are unchanged), but troops belong to the division: anybody can command any troops, and
// before each fight the player chooses which troops the fighting general takes. Committing a
// plan moves the chosen troops onto that general; the rest stay in the pool.
import { getGameData, type Disposition } from '../data';
import { deriveTroopStats, type ProgressTroop } from '../progression';
import type { SideSetup, SquadSetup } from '../sim';
import { mpOf } from './mp';
import { companySquads } from './squads';
import type { GeneralRecord, War } from './types';

export interface WarArmySquad { name: string; disposition: Disposition; troopIds: string[] }
/** Same shape as the Skirmish campaign's PlayerArmy, so its planning helpers apply. */
export interface WarArmy { formationId: string; squads: WarArmySquad[] }

function general(war: War, id: string): GeneralRecord {
  const g = war.generals.find(x => x.id === id);
  if (!g) throw new Error(`Unknown general ${id}`);
  return g;
}

/**
 * Generals sharing a troop pool with this one: every member of its division (a fallen member
 * still holds division troops), or the living generals of its castle's garrison.
 */
export function poolGenerals(war: War, generalId: string): GeneralRecord[] {
  const g = general(war, generalId);
  const division = war.divisions.find(d => d.generals.includes(generalId));
  if (division) return division.generals.map(id => general(war, id));
  return war.generals.filter(x => x.factionId === g.factionId && x.nodeId === g.nodeId && (x.id === generalId || x.hp > 0) && !war.divisions.some(d => d.generals.includes(x.id)));
}

/**
 * A general is leaving its pool (beaten in battle): the troops it held without fighting go back
 * to the pool members who remain, as far as their command allows. Returns how many were left
 * with the leaving general for lack of room.
 */
export function returnBenched(war: War, generalId: string, deployedIds: Iterable<string>): number {
  const leaver = general(war, generalId);
  const deployed = new Set(deployedIds);
  const stay = poolGenerals(war, generalId).filter(m => m !== leaver);
  const benched = leaver.troops.filter(t => !deployed.has(t.id));
  const kept = leaver.troops.filter(t => deployed.has(t.id));
  for (const m of stay) while (benched.length && m.troops.length < m.capacity) m.troops.push(benched.shift()!);
  leaver.troops = [...kept, ...benched];
  return benched.length;
}

/** Every troop this general could field. */
export function fightPool(war: War, generalId: string): ProgressTroop[] {
  return poolGenerals(war, generalId).flatMap(g => g.troops);
}

/** Throws unless the pool can field this plan under this general. Never mutates. */
export function validateArmy(war: War, generalId: string, army: WarArmy): void {
  const game = getGameData();
  const c = game.constants;
  const g = general(war, generalId);
  if (!game.formationById.has(army.formationId)) throw new Error(`Unknown formation ${army.formationId}`);
  const limit = Math.min(c.MAX_SQUADS, game.formationById.get(army.formationId)!.slots.length);
  if (army.squads.length > limit) throw new Error(`At most ${limit} squads`);
  const pool = new Set(fightPool(war, generalId).map(t => t.id));
  const used = new Set<string>();
  for (const sq of army.squads) {
    if (sq.troopIds.length < c.MIN_SQUAD) throw new Error(`Squad ${sq.name} needs at least ${c.MIN_SQUAD} troops`);
    for (const id of sq.troopIds) {
      if (!pool.has(id)) throw new Error(`Troop ${id} is not in this general's pool`);
      if (used.has(id)) throw new Error(`Troop ${id} is deployed twice`);
      used.add(id);
    }
  }
  const room = Math.min(g.capacity, c.MAX_COMPANY);
  if (used.size > room) throw new Error(`${g.name} can command at most ${room} troops`);
}

/**
 * Move the planned troops onto the fighting general. Its unplanned troops go to pool members
 * with room; any left over stay with it, benched for this fight. Idempotent for the same plan.
 */
export function applyArmy(war: War, generalId: string, army: WarArmy): void {
  validateArmy(war, generalId, army);
  const fighter = general(war, generalId);
  const members = poolGenerals(war, generalId);
  const chosen = new Set(army.squads.flatMap(q => q.troopIds));
  const byId = new Map(members.flatMap(m => m.troops.map(t => [t.id, t] as const)));
  const spare = fighter.troops.filter(t => !chosen.has(t.id));
  for (const m of members) if (m !== fighter) m.troops = m.troops.filter(t => !chosen.has(t.id));
  fighter.troops = [...chosen].map(id => byId.get(id)!);
  for (const m of members) {
    if (m === fighter || m.hp <= 0) continue;
    while (spare.length && m.troops.length < m.capacity) m.troops.push(spare.shift()!);
  }
  fighter.troops.push(...spare);
}

/** Battle side for a general: the prepared army if given, else what the general holds (AI). */
export function armySide(war: War, g: GeneralRecord, sideIndex: 0 | 1, army?: WarArmy | null): SideSetup {
  const game = getGameData();
  const profile = game.generalById.get(g.generalId);
  if (!profile) throw new Error(`Missing general profile ${g.generalId}`);
  const base = { generalId: g.generalId, general: { ...profile, hp: Math.max(1, g.hp), level: g.level }, startMp: mpOf(g) };
  if (!army) {
    const formationId = game.formations[0]?.id;
    if (!formationId) throw new Error('No battle formation is available');
    return { ...base, formationId, squads: companySquads(g.troops, `side${sideIndex}-${g.id}`) };
  }
  applyArmy(war, g.id, army);
  const byId = new Map(g.troops.map(t => [t.id, t]));
  const squads: SquadSetup[] = army.squads.map((sq, i) => ({
    id: `side${sideIndex}-${g.id}-squad${i}`, name: sq.name, disposition: sq.disposition,
    troops: sq.troopIds.map(id => { const t = byId.get(id)!; const unit = game.unitById.get(t.unitId)!; return { troopId: t.id, name: t.name, unitId: t.unitId, statMult: deriveTroopStats(unit, t.level).damageMultiplier }; }),
  }));
  return { ...base, formationId: army.formationId, squads };
}
