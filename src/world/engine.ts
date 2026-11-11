import { getGameData } from '../data';
import worldConstants from '../../data/world-constants.json';
import { resolveTurn } from './turn';
import { joinDivision, leaveAsGarrison } from './garrison';
import { adoptCaptive } from './adopt';
import type { ClassId, GeneralId } from '../data/schemas';
import { getRunConfig } from '../run/config';
import { uniqueName } from '../data/names';
import type { ProgressTroop } from '../progression';
import type { BuiltWorldData } from './data';
import { internal, nextId, pick, worldRng, type WorldInternal } from './rng';
import type { GeneralRecord, War } from './types';
export interface WarSetup { seed: number; heroId: GeneralId; heroName: string }

/**
 * The hero's opening army: hero class plus its configured partner, with the campaign's
 * own troop count per stage-1 line (not the smaller Skirmish demo roster).
 */
/** What a hero starts with, without drawing anything: shared by createWar and the start screen. */
export function startingArmyPlan(heroId: GeneralId, perKind = worldConstants.PLAYER_STARTING_TROOPS_PER_LINE): { classes: ClassId[]; units: string[]; perKind: number } {
  const game = getGameData();
  const run = getRunConfig();
  const heroClass = game.unitById.get(game.generalById.get(heroId)!.unitId)!.classId;
  const partner = run.startingPartners[heroClass];
  if (!partner) throw new Error(`class ${heroClass} has no starting partner`);
  const classes: ClassId[] = [heroClass, partner];
  const units = classes.flatMap(c => game.units.filter(u => u.stage === 1 && u.classId === c).sort((a, b) => a.line.localeCompare(b.line)).map(u => u.id));
  return { classes, units, perKind };
}

function startingArmy(war: War, heroId: GeneralId): { classes: ClassId[]; troops: ProgressTroop[] } {
  const { rng } = war._internal as WorldInternal;
  const game = getGameData();
  const plan = startingArmyPlan(heroId, internal(war).data.constants.PLAYER_STARTING_TROOPS_PER_LINE);
  const taken = new Set(war.generals.flatMap(g => g.troops.map(t => t.name)));
  const troops: ProgressTroop[] = [];
  for (const unitId of plan.units) for (let i = 0; i < plan.perKind; i++) {
    troops.push({ id: nextId(rng, 'troop'), name: uniqueName(rng, game.names, taken), unitId, xp: 0, level: 1 });
  }
  return { classes: plan.classes, troops };
}

/** Fresh level-one troops from the faction's unlocked classes. */
export function freshTroops(war: War, classes: War['factions'][number]['classes'], count: number): ProgressTroop[] {
  const { rng } = war._internal as WorldInternal;
  const game = getGameData();
  const units = game.units.filter(u => u.stage === 1 && classes.includes(u.classId));
  if (!units.length) throw new Error('No unlocked stage-1 troops');
  const taken = new Set(war.generals.flatMap(g => g.troops.map(t => t.name)));
  return Array.from({ length: count }, () => ({ id: nextId(rng, 'troop'), name: uniqueName(rng, game.names, taken), unitId: pick(rng, units).id, xp: 0, level: 1 }));
}
export function createWar(data: BuiltWorldData, setup: WarSetup): War {
  const game = getGameData();
  const hero = game.generalById.get(setup.heroId);
  if (!hero) throw new Error(`Unknown hero ${setup.heroId}`);
  const c = data.constants;
  const rng = worldRng(setup.seed);
  const state: WorldInternal = { data: structuredClone(data), rng, pending: [], supply: Object.fromEntries(data.nodes.map(n => [n.id, n.supplyPerWeek])), paths: {} };
  const war: War = { version: 1, id: nextId(rng, 'war'), seed: setup.seed, turn: 1, week: 1, phase: 'orders', factions: data.factions.map(f => ({ ...structuredClone(f), gold: c.STARTING_GOLD, captives: [] })), nodes: structuredClone(data.nodes), routes: structuredClone(data.routes), generals: [], divisions: [], pendingBattle: null, events: [], turnLog: [], _internal: state };
  const taken = new Set([setup.heroName]);
  for (const faction of [...war.factions].sort((a, b) => a.id.localeCompare(b.id))) {
    const castle = war.nodes.find(n => n.kind === 'castle' && n.owner === faction.id)!;
    const generals: GeneralRecord[] = [];
    if (faction.isPlayer) {
      // The hero marches with the other generals of its class; more come from adopting beaten rivals.
      const heroClass = game.unitById.get(hero.unitId)!.classId;
      const mates = game.generals.filter(g => g.id !== hero.id && game.unitById.get(g.unitId)!.classId === heroClass).sort((a, b) => a.id.localeCompare(b.id));
      for (const profile of [hero, ...mates]) {
        const isHero = profile.id === hero.id;
        const general: GeneralRecord = { id: nextId(rng, 'general'), name: isHero ? setup.heroName : uniqueName(rng, game.names, taken), generalId: profile.id, factionId: faction.id, isHero, level: 1, xp: 0, hp: profile.hp, maxHp: profile.hp, capacity: c.PLAYER_STARTING_CAPACITY, troops: [], injuredTurns: 0, nodeId: castle.id };
        war.generals.push(general);
        generals.push(general);
      }
      // One shared army for the division: dealt round-robin so every general holds a mix. Who
      // fights with which troops is chosen before each fight, so this split is never shown.
      const army = startingArmy(war, hero.id);
      if (army.troops.length > c.PLAYER_STARTING_CAPACITY * generals.length) throw new Error('Starting army exceeds the generals\' command');
      faction.classes = army.classes;
      army.troops.forEach((t, i) => generals[i % generals.length]!.troops.push(t));
    } else {
      const profiles = game.generals.filter(g => faction.classes.includes(game.unitById.get(g.unitId)!.classId));
      for (let i = 0; i < c.RIVAL_GENERALS; i++) {
        const profile = pick(rng, profiles);
        const general: GeneralRecord = { id: nextId(rng, 'general'), name: uniqueName(rng, game.names, taken), generalId: profile.id, factionId: faction.id, isHero: false, level: 1, xp: 0, hp: profile.hp, maxHp: profile.hp, capacity: c.STARTING_CAPACITY, troops: [], injuredTurns: 0, nodeId: castle.id };
        war.generals.push(general);
        general.troops = freshTroops(war, faction.classes, c.STARTING_CAPACITY);
        generals.push(general);
      }
    }
    // Rivals open with a small field force; the rest stay home as the castle garrison.
    const deployed = faction.isPlayer ? generals.length : c.RIVAL_OPENING_FIELD[faction.personality];
    const size = faction.isPlayer ? c.MAX_DIVISION_GENERALS : Math.min(c.MAX_DIVISION_GENERALS, c.RIVAL_OPENING_DIVISION_SIZE);
    for (let i = 0; i < deployed; i += size) {
      const id = nextId(rng, 'division');
      const members = generals.slice(i, Math.min(deployed, i + size));
      war.divisions.push({ id, factionId: faction.id, generals: members.map(g => g.id), muster: members.reduce((n, g) => n + g.troops.length, 0), atNode: castle.id, previousNode: null });
      state.paths[id] = [];
    }
  }
  return war;
}

/** Queue one copied order per division; replacement does not mutate any other state. */
export function issueOrder(war: War, order: import('./types').WorldOrder): void {
  if (war.phase !== 'orders' || internal(war).activeTurn) return;
  if (!war.divisions.some(d => d.id === order.division)) throw new Error(`Unknown division ${order.division}`);
  const { pending } = war._internal as WorldInternal;
  const index = pending.findIndex(o => o.division === order.division);
  if (index < 0) pending.push({ ...order });
  else pending[index] = { ...order };
}

/** Read-only view of this turn's queued orders; the copies never alias the queue. */
export function queuedOrders(war: War): import('./types').WorldOrder[] {
  return internal(war).pending.map(order => ({ ...order }));
}

/** Withdraw a division's queued order so it holds by default; same phase rules as issueOrder. */
export function cancelOrder(war: War, divisionId: string): void {
  if (war.phase !== 'orders' || internal(war).activeTurn) return;
  const state = internal(war);
  state.pending = state.pending.filter(o => o.division !== divisionId);
}

/** FNV-style dual integer mix, matching the battle hash; canonical ids remove array-order bias. */
export function hashWar(war: War): string {
  let h1 = 0x811c9dc5; let h2 = 0x1000193;
  const mix = (n: number) => {
    const v = Math.round(n * 1000) | 0;
    h1 = Math.imul(h1 ^ v, 0x01000193);
    h2 = Math.imul((h2 + v) | 0, 0x85ebca6b);
  };
  const text = (s: string | null) => { mix(s === null ? -1 : s.length); if (s !== null) for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); };
  mix(war.seed); mix(war.turn); mix(war.week); text(war.phase);
  for (const n of [...war.nodes].sort((a, b) => a.id.localeCompare(b.id))) { text(n.id); text(n.owner); }
  for (const d of [...war.divisions].sort((a, b) => a.id.localeCompare(b.id))) { text(d.id); text(d.factionId); text(d.atNode); text(d.previousNode); for (const id of d.generals) text(id); }
  for (const g of [...war.generals].sort((a, b) => a.id.localeCompare(b.id))) {
    text(g.id); text(g.nodeId); mix(g.hp); mix(g.injuredTurns); mix(g.troops.length);
    for (const t of g.troops) { text(t.id); text(t.unitId); mix(t.xp); mix(t.level); }
  }
  for (const f of [...war.factions].sort((a, b) => a.id.localeCompare(b.id))) { text(f.id); mix(f.gold); }
  const state = war._internal as WorldInternal;
  mix(state.rng.state);
  for (const id of Object.keys(state.supply).sort()) { text(id); mix(state.supply[id]!); }
  text(JSON.stringify(war.pendingBattle));
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}


/** Replay completed turn records. maxTurns caps the number of records applied.
 * Admin is cleared only when another record follows; battles require Phase 3 results.
 */
/**
 * Rebuild a war from its seed and log. Battles are not re-fought, so replay stops at a battle;
 * an action that depends on one (adopting its captive) throws instead of silently diverging.
 * `prepare` lets tests reshape the fresh war exactly as the original was reshaped.
 */
export function replayWar(data: BuiltWorldData, setup: WarSetup, turnLog: import('./types').RecordedWorldTurn[], maxTurns = turnLog.length, prepare: (war: War) => War = w => w): War {
  const war = prepare(createWar(data, setup));
  for (const record of turnLog.slice(0, Math.max(0, maxTurns))) {
    if (war.phase === 'battle' || war.phase === 'won' || war.phase === 'lost') break;
    if (record.turn !== war.turn) throw new Error(`Replay turn ${record.turn}: expected ${war.turn}`);
    if (war.phase === 'admin') war.phase = 'orders';
    for (const action of record.actions ?? []) {
      if (action.type === 'leaveGarrison') leaveAsGarrison(war, action.division, action.general);
      else if (action.type === 'joinDivision') joinDivision(war, action.division, action.general);
      else adoptCaptive(war, action.faction, action.captive, action.division);
    }
    for (const order of record.orders) issueOrder(war, order);
    resolveTurn(war);
  }
  return war;
}
