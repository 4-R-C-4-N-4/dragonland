// War persistence: one versioned snapshot under one key, written atomically per transition.
// A corrupt or semantically impossible save is REPORTED, never silently rewritten or repaired.
import type { GameData } from '../data';
import { awardTroopXp, type UnitById } from '../progression';
import type { BuiltWorldData } from './data';
import { createRng } from '../sim/rng';
import type { WorldInternal } from './rng';
import { WarSnapshotSchema, type WarSnapshot } from './schema';
import type { War } from './types';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const WAR_KEY = 'dragonland.war.v1';

export type LoadedWar = { kind: 'none' } | { kind: 'ok'; state: War } | { kind: 'corrupt'; error: string };

/** Strip the live war down to the persisted fields. The authored map is rebuilt on load. */
export function toSnapshot(war: War): WarSnapshot {
  const state = war._internal as WorldInternal;
  return {
    version: 1,
    id: war.id,
    seed: war.seed,
    turn: war.turn,
    week: war.week,
    phase: war.phase,
    factions: war.factions.map(f => ({ ...f, captives: [...f.captives], classes: [...f.classes] })),
    nodes: war.nodes.map(n => ({ id: n.id, owner: n.owner })),
    generals: war.generals.map(g => ({ ...g, troops: g.troops.map(t => ({ ...t })) })),
    divisions: war.divisions.map(d => ({ ...d, generals: [...d.generals] })),
    pendingBattle: war.pendingBattle ? { ...war.pendingBattle, wild: war.pendingBattle.wild.map(w => ({ ...w })), processedSkirmishIds: [...war.pendingBattle.processedSkirmishIds] } : null,
    turnLog: war.turnLog.map(r => ({ turn: r.turn, orders: r.orders.map(o => ({ ...o })) })),
    internal: {
      rngState: state.rng.state,
      pending: state.pending.map(o => ({ ...o })),
      supply: { ...state.supply },
      paths: Object.fromEntries(Object.entries(state.paths).map(([k, v]) => [k, [...v]])),
      ...(state.activeTurn ? { activeTurn: { ...state.activeTurn, orders: state.activeTurn.orders.map(o => ({ ...o })), starts: { ...state.activeTurn.starts }, resolved: [...state.activeTurn.resolved] } } : {}),
    },
  };
}

/** Rebuild a live war from a snapshot plus the authored map. Assumes it is already validated. */
export function fromSnapshot(data: BuiltWorldData, snapshot: WarSnapshot): War {
  const owner = new Map(snapshot.nodes.map(n => [n.id, n.owner]));
  const state: WorldInternal = {
    data: structuredClone(data),
    rng: createRng(snapshot.internal.rngState),
    pending: snapshot.internal.pending.map(o => ({ ...o })),
    supply: { ...snapshot.internal.supply },
    paths: Object.fromEntries(Object.entries(snapshot.internal.paths).map(([k, v]) => [k, [...v]])),
    ...(snapshot.internal.activeTurn ? { activeTurn: { ...snapshot.internal.activeTurn, orders: snapshot.internal.activeTurn.orders.map(o => ({ ...o })) } } : {}),
  };
  return {
    version: 1,
    id: snapshot.id,
    seed: snapshot.seed,
    turn: snapshot.turn,
    week: snapshot.week,
    phase: snapshot.phase,
    factions: snapshot.factions.map(f => ({ ...f, classes: [...f.classes] as War['factions'][number]['classes'] })),
    // Ownership is the only mutable node field; everything else comes from the authored map.
    nodes: data.nodes.map(n => ({ ...n, owner: owner.get(n.id) ?? null })),
    routes: data.routes.map(r => ({ ...r })),
    generals: snapshot.generals.map(g => ({ ...g, troops: g.troops.map(t => ({ ...t })) })),
    divisions: snapshot.divisions.map(d => ({ ...d, generals: [...d.generals] })),
    pendingBattle: snapshot.pendingBattle ? { ...snapshot.pendingBattle } : null,
    events: [],
    turnLog: snapshot.turnLog.map(r => ({ turn: r.turn, orders: r.orders.map(o => ({ ...o })) })),
    _internal: state,
  };
}

/**
 * Semantic checks beyond the schema: references, uniqueness, caps and legal progression.
 * Throws on the first problem so the caller can show recovery with the real reason.
 */
export function validateWar(data: BuiltWorldData, game: GameData, war: War): void {
  const units = Object.fromEntries(game.unitById) as UnitById;
  const constants = data.constants;

  const factionIds = new Set(war.factions.map(f => f.id));
  if (factionIds.size !== war.factions.length) throw new Error('duplicate faction id');
  for (const authored of data.factions) if (!factionIds.has(authored.id)) throw new Error(`save is missing authored faction ${authored.id}`);
  if (war.factions.filter(f => f.isPlayer).length !== 1) throw new Error('exactly one player faction is required');

  // The authored map defines topology; a save may only differ in node ownership.
  if (war.nodes.length !== data.nodes.length) throw new Error('save node count does not match the authored map');
  if (war.routes.length !== data.routes.length) throw new Error('save route count does not match the authored map');
  for (const node of war.nodes) {
    const authored = data.nodeById.get(node.id);
    if (!authored) throw new Error(`unknown node ${node.id}`);
    if (node.kind !== authored.kind || node.biome !== authored.biome || node.garrisonCap !== authored.garrisonCap) throw new Error(`node ${node.id} does not match the authored map`);
    if (node.owner !== null && !factionIds.has(node.owner)) throw new Error(`node ${node.id}: unknown owner ${node.owner}`);
  }
  for (const route of war.routes) {
    const authored = data.routeById.get(route.id);
    if (!authored || authored.from !== route.from || authored.to !== route.to) throw new Error(`route ${route.id} does not match the authored map`);
  }

  const generalIds = new Set<string>();
  const troopIds = new Set<string>();
  const troopNames = new Set<string>();
  for (const g of war.generals) {
    if (generalIds.has(g.id)) throw new Error(`duplicate general id ${g.id}`);
    generalIds.add(g.id);
    if (!factionIds.has(g.factionId)) throw new Error(`general ${g.name}: unknown faction ${g.factionId}`);
    if (!game.generalById.has(g.generalId)) throw new Error(`general ${g.name}: unknown general ${g.generalId}`);
    if (!data.nodeById.has(g.nodeId)) throw new Error(`general ${g.name}: unknown node ${g.nodeId}`);
    if (g.hp > g.maxHp) throw new Error(`general ${g.name}: hp above maxHp`);
    if (g.troops.length > g.capacity) throw new Error(`general ${g.name}: ${g.troops.length} troops exceeds capacity ${g.capacity}`);
    for (const t of g.troops) {
      if (troopIds.has(t.id)) throw new Error(`duplicate troop id ${t.id}`);
      if (troopNames.has(t.name)) throw new Error(`duplicate troop name ${t.name}`);
      troopIds.add(t.id);
      troopNames.add(t.name);
      if (!game.unitById.has(t.unitId)) throw new Error(`troop ${t.name}: unknown unit ${t.unitId}`);
      // Zero XP re-derives level and evolution; any change means the saved troop is inconsistent.
      const same = awardTroopXp(t, 0, units);
      if (same.level !== t.level || same.unitId !== t.unitId) throw new Error(`troop ${t.name}: level/species do not match XP`);
    }
  }
  const heroes = war.generals.filter(g => g.isHero);
  const player = war.factions.find(f => f.isPlayer)!;
  if (heroes.length !== 1 || heroes[0]!.factionId !== player.id) throw new Error('exactly one hero belonging to the player faction is required');

  const divisionIds = new Set<string>();
  const assigned = new Set<string>();
  for (const d of war.divisions) {
    if (divisionIds.has(d.id)) throw new Error(`duplicate division id ${d.id}`);
    divisionIds.add(d.id);
    if (!factionIds.has(d.factionId)) throw new Error(`division ${d.id}: unknown faction ${d.factionId}`);
    if (!data.nodeById.has(d.atNode)) throw new Error(`division ${d.id}: unknown node ${d.atNode}`);
    if (d.previousNode !== null && !data.nodeById.has(d.previousNode)) throw new Error(`division ${d.id}: unknown previous node ${d.previousNode}`);
    if (d.generals.length > constants.MAX_DIVISION_GENERALS) throw new Error(`division ${d.id}: ${d.generals.length} generals exceeds the cap ${constants.MAX_DIVISION_GENERALS}`);
    if (new Set(d.generals).size !== d.generals.length) throw new Error(`division ${d.id}: duplicate general`);
    for (const id of d.generals) {
      if (assigned.has(id)) throw new Error(`general ${id} is assigned to more than one division`);
      assigned.add(id);
      const g = war.generals.find(x => x.id === id);
      if (!g) throw new Error(`division ${d.id}: unknown general ${id}`);
      if (g.factionId !== d.factionId) throw new Error(`division ${d.id}: general ${g.name} belongs to ${g.factionId}`);
      if (g.nodeId !== d.atNode) throw new Error(`division ${d.id}: general ${g.name} is at ${g.nodeId}`);
    }
  }

  for (const f of war.factions) {
    if (new Set(f.captives).size !== f.captives.length) throw new Error(`faction ${f.id}: duplicate captive`);
    for (const id of f.captives) {
      const captive = war.generals.find(g => g.id === id);
      if (!captive) throw new Error(`faction ${f.id}: unknown captive ${id}`);
      if (captive.factionId === f.id) throw new Error(`faction ${f.id}: captive ${captive.name} is already owned`);
    }
  }

  const battle = war.pendingBattle;
  if ((war.phase === 'battle') !== !!battle) throw new Error('battle phase and pending battle must agree');
  if (battle) {
    if (!data.nodeById.has(battle.nodeId)) throw new Error(`pending battle: unknown node ${battle.nodeId}`);
    if (!divisionIds.has(battle.attacker)) throw new Error(`pending battle: unknown attacker ${battle.attacker}`);
    if (battle.defender !== null && !divisionIds.has(battle.defender)) throw new Error(`pending battle: unknown defender ${battle.defender}`);
    if (battle.defender === battle.attacker) throw new Error('pending battle: a division cannot fight itself');
    for (const w of battle.wild) if (!game.unitById.has(w.unitId)) throw new Error(`pending battle: unknown wild unit ${w.unitId}`);
  }

  const state = war._internal as WorldInternal;
  for (const id of Object.keys(state.supply)) if (!data.nodeById.has(id)) throw new Error(`weekly supply for unknown node ${id}`);
  for (const [id, path] of Object.entries(state.paths)) {
    if (!divisionIds.has(id)) throw new Error(`arrival path for unknown division ${id}`);
    for (const node of path) if (!data.nodeById.has(node)) throw new Error(`division ${id}: arrival path names unknown node ${node}`);
  }
  const order = (o: { division: string; toNode?: string }, where: string): void => {
    if (!divisionIds.has(o.division)) throw new Error(`${where}: unknown division ${o.division}`);
    if (o.toNode !== undefined && !data.nodeById.has(o.toNode)) throw new Error(`${where}: unknown node ${o.toNode}`);
  };
  for (const o of state.pending) order(o, 'queued order');
  const frame = state.activeTurn;
  if (frame) {
    if (frame.turn !== war.turn) throw new Error('active turn frame does not match the current turn');
    for (const o of frame.orders) order(o, 'active turn order');
    for (const [id, node] of Object.entries(frame.starts)) {
      if (!divisionIds.has(id)) throw new Error(`active turn frame: unknown division ${id}`);
      if (!data.nodeById.has(node)) throw new Error(`active turn frame: unknown start node ${node}`);
    }
  }
  for (const record of war.turnLog) {
    if (record.turn >= war.turn + 1) throw new Error(`turn log records turn ${record.turn} at or beyond the current turn`);
    for (const o of record.orders) if (!o.division) throw new Error('turn log order without a division');
  }
}

export function loadWar(storage: StorageLike, data: BuiltWorldData, game: GameData): LoadedWar {
  const raw = storage.getItem(WAR_KEY);
  if (raw == null) return { kind: 'none' };
  try {
    const snapshot = WarSnapshotSchema.parse(JSON.parse(raw));
    const war = fromSnapshot(data, snapshot);
    validateWar(data, game, war);
    return { kind: 'ok', state: war };
  } catch (e) {
    return { kind: 'corrupt', error: e instanceof Error ? e.message : String(e) };
  }
}

export function saveWar(storage: StorageLike, war: War): void {
  storage.setItem(WAR_KEY, JSON.stringify(toSnapshot(war)));
}

export function clearWar(storage: StorageLike): void {
  storage.removeItem(WAR_KEY);
}
