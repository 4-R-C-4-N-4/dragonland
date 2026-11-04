import legacyGenerals from '../fixtures/legacy-generals.json';
import { createBattle } from '../../src/sim';
import { describe, expect, it } from 'vitest';
import { getGameData, SpecialDefSchema } from '../../src/data';
import { applyBattleResult, chooseEncounter, clearRun, getRunConfig, loadRun, newRun, RUN_KEY, saveRun, startBattle, type StorageLike } from '../../src/run';

const data = getGameData();

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('run storage', () => {
  it('round-trips a run through one key', () => {
    const s = newRun(data, { seed: 4, generalId: 'paladin' });
    const store = memory();
    expect(loadRun(store, data)).toEqual({ kind: 'none' });
    saveRun(store, s);
    expect([...store.map.keys()]).toEqual([RUN_KEY]);
    expect(loadRun(store, data)).toEqual({ kind: 'ok', state: s });
    clearRun(store);
    expect(loadRun(store, data).kind).toBe('none');
  });

  it('keeps a frozen battle so a reload restarts the same fight', () => {
    let s = newRun(data, { seed: 4, generalId: 'paladin' });
    s = chooseEncounter(s, s.offers[0]!.id);
    const ids = s.roster.slice(0, 4).map((t) => t.id);
    s = startBattle(data, s, { formationId: 'wedge', squads: [{ name: 'A', disposition: 'mixed', troopIds: ids }] });
    const store = memory();
    saveRun(store, s);
    const loaded = loadRun(store, data);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') expect(loaded.state.battle).toEqual(s.battle);
  });

  it('accepts an empty roster as a legitimate save', () => {
    let s = newRun(data, { seed: 8, generalId: 'dragon' });
    s = chooseEncounter(s, s.offers[0]!.id);
    const ids = s.roster.map((t) => t.id);
    s = startBattle(data, s, { formationId: 'line', squads: [{ name: 'All', disposition: 'fierce', troopIds: ids }] });
    s = applyBattleResult(data, s, s.battle!.id, { winner: 0, dead: [ids, []], survivors: [[], []] }, { ...getRunConfig(), woundedRecoveryOnWin: 0 });
    expect(s.roster).toHaveLength(0);
    const store = memory();
    saveRun(store, s);
    expect(loadRun(store, data).kind).toBe('ok');
  });

  it('reports corrupt saves instead of replacing them', () => {
    const store = memory();
    store.setItem(RUN_KEY, '{not json');
    expect(loadRun(store, data).kind).toBe('corrupt');
    const s = newRun(data, { seed: 4, generalId: 'paladin' });
    store.setItem(RUN_KEY, JSON.stringify({ ...s, roster: [{ ...s.roster[0]!, level: 9 }] }));
    const bad = loadRun(store, data);
    expect(bad.kind).toBe('corrupt');
    store.setItem(RUN_KEY, JSON.stringify({ ...s, roster: [s.roster[0], s.roster[0]] }));
    expect(loadRun(store, data).kind).toBe('corrupt');
    store.setItem(RUN_KEY, JSON.stringify({ ...s, roster: [{ ...s.roster[0]!, unitId: 'ghost' }] }));
    expect(loadRun(store, data).kind).toBe('corrupt');
    expect(store.getItem(RUN_KEY)).not.toBeNull();
  });

  it('rejects a save missing the hero class from unlockedClasses', () => {
    const s = newRun(data, { seed: 4, generalId: 'paladin' });
    const store = memory();
    const heroUnit = data.unitById.get(data.generalById.get(s.hero.generalId)!.unitId)!;
    const stripped = { ...s, unlockedClasses: s.unlockedClasses.filter((c) => c !== heroUnit.classId) };
    store.setItem(RUN_KEY, JSON.stringify(stripped));
    expect(loadRun(store, data).kind).toBe('corrupt');
  });

  it('reports a pre-D24 version-1 save as corrupt, never silently granting a fresh army', () => {
    const s = newRun(data, { seed: 4, generalId: 'paladin' });
    const store = memory();
    const { unlockedClasses, ...rest } = s;
    void unlockedClasses;
    store.setItem(RUN_KEY, JSON.stringify({ ...rest, version: 1, startClass: 'human' }));
    expect(loadRun(store, data).kind).toBe('corrupt');
  });
});

it('loads actual legacy v2 frozen general snapshots without recruiting or losing progress', () => {
  let s = newRun(data, { seed: 4, generalId: 'paladin' });
  s = chooseEncounter(s, s.offers[0]!.id);
  s = startBattle(data, s, { formationId: 'line', squads: [{ name: 'A', disposition: 'mixed', troopIds: s.roster.slice(0, 4).map((t) => t.id) }] });
  const legacy = JSON.parse(JSON.stringify(s));
  // Use the old content shape in every persisted frozen definition, including offers.
  const freeze = (side: typeof legacy.battle.setup.sides[number]) => {
    const old = legacyGenerals.find((g) => g.id === side.generalId)!;
    side.general = { ...old, hp: old.hp + 123, special: { ...old.special, power: 1.7 } };
  };
  legacy.battle.setup.sides.forEach(freeze);
  freeze(legacy.encounter.side);
  legacy.offers.forEach((offer: typeof legacy.encounter) => freeze(offer.side));
  const store = memory();
  const raw = JSON.stringify(legacy);
  store.setItem(RUN_KEY, raw);
  const loaded = loadRun(store, data);
  expect(loaded.kind).toBe('ok');
  if (loaded.kind !== 'ok') throw new Error('legacy snapshot rejected');
  expect(loaded.state).toMatchObject({ version: 2, phase: 'battle', roster: s.roster, hero: s.hero, recruitOffers: s.recruitOffers, battleCounter: s.battleCounter, processedBattleIds: s.processedBattleIds });
  for (const side of loaded.state.battle!.setup.sides) {
    const old = legacyGenerals.find((g) => g.id === side.generalId)!;
    expect(side.general).toMatchObject({ hp: old.hp + 123, special: { rechargeS: old.special.cooldownS, power: 1.7, effects: SpecialDefSchema.parse(old.special).effects } });
    expect(side.general!.special).not.toHaveProperty('cooldownS');
    expect(side.general!.special).not.toHaveProperty('mpCost');
  }
  const restarted = createBattle(data, loaded.state.battle!.setup);
  expect(restarted.generals.map((g) => g.mp)).toEqual([0, 0]);
  expect(restarted.generals[0].def).toEqual(loaded.state.battle!.setup.sides[0].general);
  for (const encounter of [...loaded.state.offers, loaded.state.encounter!]) {
    expect(encounter.side.general!.special).toHaveProperty('rechargeS');
    expect(encounter.side.general!.special).not.toHaveProperty('cooldownS');
  }
  expect(store.getItem(RUN_KEY)).toBe(raw);
  saveRun(store, loaded.state);
  expect(loadRun(store, data)).toEqual(loaded);
  legacy.battle.setup.sides[0].general.special.rechargeS = 0;
  store.setItem(RUN_KEY, JSON.stringify(legacy));
  expect(loadRun(store, data).kind).toBe('corrupt');
});
