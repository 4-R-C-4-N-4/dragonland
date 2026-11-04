import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle } from '../../src/sim';
import { chooseEncounter, loadRun, newRun, saveRun, startBattle, type RunState } from '../../src/run';
import type { BattleView, BattleViewOptions } from '../../src/battle/types';
import { createStore, type Store } from '../../src/persist/store';
import type { Loadout } from '../../src/data';
import { dom, ElementMock } from '../helpers/dom';
const mocks = vi.hoisted(() => ({ start: vi.fn(), builder: vi.fn(), headless: vi.fn() }));
vi.mock('../../src/battle/view', () => ({ startBattleView: mocks.start }));
vi.mock('../../src/ui/builder', () => ({ mountBuilder: mocks.builder }));
vi.mock('../../src/ui/flow/headlessBattle', () => ({ runHeadlessBattle: mocks.headless }));
import { mountRun } from '../../src/ui/run';
import { mountFlow } from '../../src/ui/flow';
const data = getGameData();
let options: BattleViewOptions, resolve: (view: BattleView) => void, reject: (e: Error) => void;
function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } } as Storage;
}
function activeRun() {
  const s = newRun(data, { seed: 44, generalId: 'paladin' });
  return startBattle(data, chooseEncounter(s, s.offers[0]!.id), { formationId: 'line', squads: [{ name: 'A', disposition: 'mixed', troopIds: s.roster.slice(0, 4).map(t => t.id) }] });
}
const flush = async () => {
  vi.useRealTimers();
  await vi.dynamicImportSettled();
  vi.useFakeTimers();
};
beforeEach(async () => {
  await import('../../src/battle/view');
  vi.stubGlobal('document', dom); vi.stubGlobal('alert', vi.fn()); vi.useFakeTimers();
  mocks.start.mockReset().mockImplementation((_root, opts) => { options = opts; return new Promise<BattleView>((yes, no) => { resolve = yes; reject = no; }); });
  mocks.builder.mockReset().mockReturnValue({ destroy: vi.fn() }); mocks.headless.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function campaign() {
  const root = new ElementMock(), storage = memory(), s = activeRun(); saveRun(storage, s);
  const handle = mountRun(root as unknown as HTMLElement, { data, storage, onSandbox: vi.fn() });
  return { root, storage, s, handle };
}
function world(s: RunState) { return createBattle(data, s.battle!.setup); }
it('campaign quit persists actual casualties and forfeiture, destroys view and ignores late finish/quit', async () => {
  const { s, storage, root, handle } = campaign(); await flush();
  const destroy = vi.fn(); resolve({ destroy }); await flush();
  const w = world(s);
  const entity = w.ents.troopId.findIndex((_, i) => w.ents.side[i] === 0 && !w.ents.isGeneral[i]);
  w.ents.alive[entity] = 0;
  const deadId = w.ents.troopId[entity]!;
  options.onQuit!(w);
  expect(destroy).toHaveBeenCalledTimes(1);
  const loaded = loadRun(storage, data); expect(loaded.kind).toBe('ok');
  if (loaded.kind === 'ok') { expect(loaded.state.lastSummary?.forfeited).toBe(true); expect(loaded.state.roster.some(t => t.id === deadId)).toBe(false); }
  expect(root.children[0]!.innerHTML).toContain('forfeited'); expect(root.children[0]!.querySelector('#dl-again')).toBeTruthy();
  w.result = { winner: 0, dead: [[], []], survivors: [[], []] } as never;
  options.onFinished(w); options.onQuit!(w); expect(loadRun(storage, data)).toEqual(loaded);
  handle.destroy(); expect(destroy).toHaveBeenCalledTimes(1);
});
it.each(['finish', 'quit', 'destroy'] as const)('campaign destroys late startup after %s and ignores late errors', async action => {
  const { s, handle } = campaign(); await flush(); const w = world(s);
  if (action === 'finish') { w.result = { winner: 1, dead: [[], []], survivors: [[], []] } as never; options.onFinished(w); }
  if (action === 'quit') options.onQuit!(w);
  if (action === 'destroy') handle.destroy();
  const destroy = vi.fn(); resolve({ destroy }); await flush(); expect(destroy).toHaveBeenCalledTimes(1); handle.destroy();
});
it('campaign stale startup errors cannot trigger headless fallback', async () => {
  const { handle } = campaign(); await flush(); handle.destroy(); reject(new Error('late')); await flush(); expect(mocks.headless).not.toHaveBeenCalled();
});
it('campaign failed persistence leaves battle actionable for retry', async () => {
  const { storage, s, handle } = campaign(); await flush();
  const write = storage.setItem; storage.setItem = () => { throw new Error('full'); };
  expect(() => options.onQuit!(world(s))).toThrow('full');
  storage.setItem = write; options.onQuit!(world(s));
  expect(loadRun(storage, data).kind).toBe('ok'); handle.destroy();
});
async function sandbox() {
  const root = new ElementMock(), s = activeRun(), roster = [...s.roster];
  const loadout: Loadout = { id: 'l', name: 'Army', generalId: 'paladin', squads: [{ id: 'a', name: 'A', disposition: 'mixed', troopIds: roster.slice(0, 4).map(t => t.id) }] };
  const store = { getRoster: () => roster, getLastComposition: () => ({}), setLastComposition: vi.fn(), saveLoadout: vi.fn(), applyBattleResult: vi.fn((ids: string[]) => { for (let i = roster.length - 1; i >= 0; i--) if (ids.includes(roster[i]!.id)) roster.splice(i, 1); }) };
  const handle = mountFlow(root as unknown as HTMLElement, { data, store: store as unknown as Store, storage: memory() });
  mocks.builder.mock.calls[0]![1].onStartBattle(loadout);
  vi.advanceTimersByTime(10);
  root.querySelector('#dl-fight')!.click(); await flush();
  return { root, handle, store };
}
it.each(['finish', 'quit', 'destroy'] as const)('sandbox owns view teardown on %s and applies quit casualties once', async action => {
  const { handle, store } = await sandbox(); const w = createBattle(data, options.setup);
  const entity = w.ents.troopId.findIndex((_, i) => w.ents.side[i] === 0 && !w.ents.isGeneral[i]);
  w.ents.alive[entity] = 0; const deadId = w.ents.troopId[entity]!;
  const destroy = vi.fn(); resolve({ destroy }); await flush();
  if (action === 'finish') { w.result = { winner: 1, dead: [[deadId], []], survivors: [[], []], durationS: 1 } as never; options.onFinished(w); }
  if (action === 'quit') { options.onQuit!(w); options.onQuit!(w); expect(store.applyBattleResult).toHaveBeenCalledExactlyOnceWith([deadId]); expect(store.saveLoadout.mock.lastCall?.[0].squads[0].troopIds).not.toContain(deadId); }
  if (action === 'destroy') handle.destroy();
  expect(destroy).toHaveBeenCalledTimes(1); handle.destroy(); expect(destroy).toHaveBeenCalledTimes(1);
});
it.each(['quit', 'destroy'] as const)('sandbox destroys late startup after %s', async action => {
  const { handle } = await sandbox(); if (action === 'quit') options.onQuit!(createBattle(data, options.setup)); else handle.destroy();
  const destroy = vi.fn(); resolve({ destroy }); await flush(); expect(destroy).toHaveBeenCalledTimes(1); handle.destroy();
});
it('sandbox ignores late startup rejection after owner destruction', async () => {
  const { handle } = await sandbox(); handle.destroy(); reject(new Error('late')); await flush(); expect(mocks.headless).not.toHaveBeenCalled();
});

it('sandbox old callbacks and errors cannot touch a replacement battle', async () => {
  const { root, handle, store } = await sandbox();
  const oldOptions = options, oldResolve = resolve;
  const oldWorld = createBattle(data, oldOptions.setup);
  oldOptions.onQuit!(oldWorld);
  const builderOpts = mocks.builder.mock.lastCall![1];
  builderOpts.onStartBattle({ id: 'next', name: 'Next', generalId: 'paladin', squads: [{ id: 'a', name: 'A', disposition: 'mixed', troopIds: store.getRoster().slice(0, 4).map(t => t.id) }] });
  vi.advanceTimersByTime(10); root.querySelector('#dl-fight')!.click(); await flush();
  expect(options).not.toBe(oldOptions);
  const oldDestroy = vi.fn(), nextDestroy = vi.fn();
  oldResolve({ destroy: oldDestroy }); resolve({ destroy: nextDestroy }); await flush();
  expect(oldDestroy).toHaveBeenCalledOnce(); expect(nextDestroy).not.toHaveBeenCalled();
  store.applyBattleResult.mockClear();
  oldWorld.result = { winner: 0 } as never;
  oldOptions.onFinished(oldWorld); oldOptions.onQuit!(oldWorld);
  expect(store.applyBattleResult).not.toHaveBeenCalled(); expect(nextDestroy).not.toHaveBeenCalled();
  handle.destroy(); expect(nextDestroy).toHaveBeenCalledOnce();
});

it('sandbox quit preserves total casualties with the real store, including across reload', async () => {
  const root = new ElementMock(), storage = memory(), store = createStore(storage, data);
  const roster = store.getRoster().slice(0, 4);
  storage.setItem('dragonland.v1.roster', JSON.stringify(roster));
  const loadout: Loadout = { id: 'last', name: 'Last company', generalId: 'paladin', squads: [
    { id: 'a', name: 'A', disposition: 'mixed', troopIds: roster.map(t => t.id) },
  ] };
  store.saveLoadout(loadout);
  const handle = mountFlow(root as unknown as HTMLElement, { data, store, storage });
  mocks.builder.mock.calls[0]![1].onStartBattle(loadout);
  vi.advanceTimersByTime(10); root.querySelector('#dl-fight')!.click(); await flush();
  const destroy = vi.fn(); resolve({ destroy }); await flush();
  const w = createBattle(data, options.setup); w.phase = 'fight';
  for (let e = 0; e < w.ents.count; e++) if (w.ents.side[e] === 0 && !w.ents.isGeneral[e]) {
    w.ents.alive[e] = 0; w.ents.hp[e] = 0;
  }
  options.onQuit!(w);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(mocks.builder).toHaveBeenCalledTimes(2);
  expect(store.getRoster()).toHaveLength(0);
  expect(createStore(storage, data).getRoster()).toHaveLength(0);
  expect(storage.getItem('dragonland.v1.roster')).toBe('[]');
  expect(store.getLoadout('last')!.squads.every(q => q.troopIds.length === 0)).toBe(true);
  handle.destroy();
});

it('sandbox retries failed loadout saving without applying casualties twice', async () => {
  const { handle, store } = await sandbox();
  const w = createBattle(data, options.setup);
  store.saveLoadout.mockImplementationOnce(() => { throw new Error('full'); });
  expect(() => options.onQuit!(w)).toThrow('full');
  options.onQuit!(w);
  expect(store.applyBattleResult).toHaveBeenCalledTimes(1);
  handle.destroy();
});
