import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { applyBattleResult, chooseEncounter, clearRun, getRunConfig, loadRun, newRun, RUN_KEY, saveRun, startBattle, type StorageLike } from '../../src/run';

const data = getGameData();

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('run storage', () => {
  it('round-trips a run through one key', () => {
    const s = newRun(data, { seed: 4, generalId: 'paladin', startClass: 'construct' });
    const store = memory();
    expect(loadRun(store, data)).toEqual({ kind: 'none' });
    saveRun(store, s);
    expect([...store.map.keys()]).toEqual([RUN_KEY]);
    expect(loadRun(store, data)).toEqual({ kind: 'ok', state: s });
    clearRun(store);
    expect(loadRun(store, data).kind).toBe('none');
  });

  it('keeps a frozen battle so a reload restarts the same fight', () => {
    let s = newRun(data, { seed: 4, generalId: 'paladin', startClass: 'ethereal' });
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
    let s = newRun(data, { seed: 8, generalId: 'dragon', startClass: 'beast' });
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
    const s = newRun(data, { seed: 4, generalId: 'paladin', startClass: 'human' });
    store.setItem(RUN_KEY, JSON.stringify({ ...s, roster: [{ ...s.roster[0]!, level: 9 }] }));
    const bad = loadRun(store, data);
    expect(bad.kind).toBe('corrupt');
    store.setItem(RUN_KEY, JSON.stringify({ ...s, roster: [s.roster[0], s.roster[0]] }));
    expect(loadRun(store, data).kind).toBe('corrupt');
    store.setItem(RUN_KEY, JSON.stringify({ ...s, roster: [{ ...s.roster[0]!, unitId: 'ghost' }] }));
    expect(loadRun(store, data).kind).toBe('corrupt');
    expect(store.getItem(RUN_KEY)).not.toBeNull();
  });
});
