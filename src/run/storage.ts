// Run persistence: one versioned snapshot under one key, written atomically per transition.
// A corrupt save is reported (never silently replaced by a fresh army); an empty roster is legal.
import type { GameData, GeneralId } from '../data';
import { awardTroopXp, pendingMilestones, type UnitById } from '../progression';
import { RunStateSchema, type RunState } from './schema';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const RUN_KEY = 'dragonland.run.v1';

export type LoadedRun = { kind: 'none' } | { kind: 'ok'; state: RunState } | { kind: 'corrupt'; error: string };

/** Semantic checks beyond the schema: references, uniqueness, legal progression. Throws on the first problem. */
export function validateRun(data: GameData, state: RunState): void {
  const units = Object.fromEntries(data.unitById) as UnitById;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const t of state.roster) {
    if (ids.has(t.id)) throw new Error(`duplicate troop id ${t.id}`);
    if (names.has(t.name)) throw new Error(`duplicate troop name ${t.name}`);
    ids.add(t.id);
    names.add(t.name);
    if (!data.unitById.has(t.unitId)) throw new Error(`troop ${t.name}: unknown unit ${t.unitId}`);
    // Zero XP re-derives level and evolution; any change means the saved troop is inconsistent.
    const same = awardTroopXp(t, 0, units);
    if (same.level !== t.level || same.unitId !== t.unitId) throw new Error(`troop ${t.name}: level/species do not match XP`);
  }
  const pending = pendingMilestones(state.hero);
  if (pending.join() !== state.pendingMilestones.join()) throw new Error('pending hero milestones do not match hero progress');
  if (!data.generalById.has(state.hero.generalId)) throw new Error(`unknown general ${state.hero.generalId}`);
  const heroUnit = data.unitById.get(data.generalById.get(state.hero.generalId)!.unitId);
  if (!heroUnit || !state.unlockedClasses.includes(heroUnit.classId)) throw new Error('unlockedClasses must include the hero class');
  if (new Set(state.unlockedClasses).size !== state.unlockedClasses.length) throw new Error('duplicate entries in unlockedClasses');
  if (state.phase === 'battle' && !state.battle) throw new Error('battle phase without a frozen battle');
  if ((state.phase === 'prepare' || state.phase === 'battle') && !state.encounter) throw new Error(`${state.phase} phase without an encounter`);
  if (state.phase === 'select' && state.offers.length === 0) throw new Error('select phase without encounter offers');
  for (const id of state.battle?.setup.sides[0].squads.flatMap((q) => q.troops.map((t) => t.troopId)) ?? []) {
    if (!ids.has(id)) throw new Error(`frozen battle references missing troop ${id}`);
  }
  // Persisted encounters, frozen setups, recruit offers and summaries are rendered
  // directly; an unknown species must surface recovery, not crash the screen.
  const unit = (unitId: string, where: string): void => {
    if (!data.unitById.has(unitId)) throw new Error(`${where}: unknown unit ${unitId}`);
  };
  const general = (side: { generalId: string; general?: { id?: string; unitId?: string } }, where: string): void => {
    const def = data.generalById.get(side.generalId as GeneralId);
    if (!def) throw new Error(`${where}: unknown general ${side.generalId}`);
    // A frozen override may carry progressed stats, but it must still describe
    // this side's own hero: the engine uses it in place of the catalog entry.
    const override = side.general;
    if (override) {
      if (override.id !== side.generalId) throw new Error(`${where}: saved general ${override.id} does not match side general ${side.generalId}`);
      unit(override.unitId ?? def.unitId, `${where} saved general ${side.generalId}`);
    }
    unit(def.unitId, `${where} general ${side.generalId}`);
  };
  const sides = [
    ...state.offers.map((o, i) => [o.side, `encounter offer ${o.id || i}`] as const),
    ...(state.encounter ? [[state.encounter.side, `encounter ${state.encounter.id}`] as const] : []),
    ...(state.battle?.setup.sides.map((side, i) => [side, `frozen battle side ${i}`] as const) ?? []),
  ];
  for (const [side, where] of sides) {
    general(side, where);
    if (!data.formationById.has(side.formationId)) throw new Error(`${where}: unknown formation ${side.formationId}`);
    for (const squad of side.squads) for (const troop of squad.troops) unit(troop.unitId, `${where} troop ${troop.name}`);
  }
  for (const offer of state.recruitOffers) for (const troop of offer.troops) unit(troop.unitId, `recruit offer ${offer.id} troop ${troop.name}`);
  for (const group of [state.lastSummary?.dead, state.lastSummary?.recovered, state.lastSummary?.survived]) {
    for (const troop of group ?? []) unit(troop.unitId, `last summary troop ${troop.name}`);
  }
  for (const evolution of state.lastSummary?.evolutions ?? []) {
    unit(evolution.from, `last summary evolution ${evolution.name}`);
    unit(evolution.to, `last summary evolution ${evolution.name}`);
  }
}

export function loadRun(storage: StorageLike, data: GameData): LoadedRun {
  const raw = storage.getItem(RUN_KEY);
  if (raw == null) return { kind: 'none' };
  try {
    const state = RunStateSchema.parse(JSON.parse(raw));
    validateRun(data, state);
    return { kind: 'ok', state };
  } catch (e) {
    return { kind: 'corrupt', error: e instanceof Error ? e.message : String(e) };
  }
}

export function saveRun(storage: StorageLike, state: RunState): void {
  storage.setItem(RUN_KEY, JSON.stringify(state));
}

export function clearRun(storage: StorageLike): void {
  storage.removeItem(RUN_KEY);
}
