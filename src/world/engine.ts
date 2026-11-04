import { getGameData } from '../data';
import { resolveTurn } from './turn';
import type { GeneralId } from '../data/schemas';
import { uniqueName } from '../data/names';
import type { ProgressTroop } from '../progression';
import type { BuiltWorldData } from './data';
import { nextId, pick, worldRng, type WorldInternal } from './rng';
import type { GeneralRecord, War } from './types';
export interface WarSetup { seed: number; heroId: GeneralId; heroName: string; split?: number[] }

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
  const split = setup.split ?? Array.from({ length: c.STARTING_GENERALS }, (_, i) => Math.floor(c.STARTING_TROOPS / c.STARTING_GENERALS) + (i < c.STARTING_TROOPS % c.STARTING_GENERALS ? 1 : 0));
  if (split.length !== c.STARTING_GENERALS || split.some(n => !Number.isInteger(n) || n < 0 || n > c.STARTING_CAPACITY) || split.reduce((a, b) => a + b, 0) !== c.STARTING_TROOPS) throw new Error('Invalid starting split: total and capacities must match');
  const rng = worldRng(setup.seed);
  const state: WorldInternal = { data: structuredClone(data), rng, pending: [], supply: Object.fromEntries(data.nodes.map(n => [n.id, n.supplyPerWeek])), paths: {} };
  const war: War = { version: 1, id: nextId(rng, 'war'), seed: setup.seed, turn: 1, week: 1, phase: 'orders', factions: data.factions.map(f => ({ ...structuredClone(f), gold: c.STARTING_GOLD, captives: [] })), nodes: structuredClone(data.nodes), routes: structuredClone(data.routes), generals: [], divisions: [], pendingBattle: null, events: [], turnLog: [], _internal: state };
  const taken = new Set([setup.heroName]);
  for (const faction of [...war.factions].sort((a, b) => a.id.localeCompare(b.id))) {
    const castle = war.nodes.find(n => n.kind === 'castle' && n.owner === faction.id)!;
    const profiles = game.generals.filter(g => faction.classes.includes(game.unitById.get(g.unitId)!.classId));
    const generals: GeneralRecord[] = [];
    for (let i = 0; i < (faction.isPlayer ? c.STARTING_GENERALS : 6); i++) {
      const isHero = faction.isPlayer && i === 0;
      const profile = isHero ? hero : pick(rng, profiles);
      const general: GeneralRecord = { id: nextId(rng, 'general'), name: isHero ? setup.heroName : uniqueName(rng, game.names, taken), generalId: profile.id, factionId: faction.id, isHero, level: 1, xp: 0, hp: profile.hp, maxHp: profile.hp, capacity: c.STARTING_CAPACITY, troops: [], injuredTurns: 0, nodeId: castle.id };
      war.generals.push(general);
      general.troops = freshTroops(war, faction.classes, faction.isPlayer ? split[i]! : c.STARTING_CAPACITY);
      generals.push(general);
    }
    const deployed = faction.isPlayer ? generals.length : faction.personality === 'aggressive' ? 5 : faction.personality === 'opportunist' ? 4 : 3;
    for (let i = 0; i < deployed; i += c.MAX_DIVISION_GENERALS) {
      const id = nextId(rng, 'division');
      war.divisions.push({ id, factionId: faction.id, generals: generals.slice(i, Math.min(deployed, i + c.MAX_DIVISION_GENERALS)).map(g => g.id), atNode: castle.id, previousNode: null });
      state.paths[id] = [];
    }
  }
  return war;
}

/** Queue one copied order per division; replacement does not mutate any other state. */
export function issueOrder(war: War, order: import('./types').WorldOrder): void {
  if (!war.divisions.some(d => d.id === order.division)) throw new Error(`Unknown division ${order.division}`);
  const { pending } = war._internal as WorldInternal;
  const index = pending.findIndex(o => o.division === order.division);
  if (index < 0) pending.push({ ...order });
  else pending[index] = { ...order };
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
export function replayWar(data: BuiltWorldData, setup: WarSetup, turnLog: import('./types').RecordedWorldTurn[], maxTurns = turnLog.length): War {
  const war = createWar(data, setup);
  for (const record of turnLog.slice(0, Math.max(0, maxTurns))) {
    if (war.phase === 'battle' || war.phase === 'won' || war.phase === 'lost') break;
    if (record.turn !== war.turn) throw new Error(`Replay turn ${record.turn}: expected ${war.turn}`);
    if (war.phase === 'admin') war.phase = 'orders';
    for (const order of record.orders) issueOrder(war, order);
    resolveTurn(war);
  }
  return war;
}
