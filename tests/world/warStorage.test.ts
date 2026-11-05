import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { awardTroopXp } from '../../src/progression';
import { buildWorldData, rawWorldData } from '../../src/world/data';
import { createWar, hashWar, issueOrder, resolveTurn } from '../../src/world';
import { internal } from '../../src/world/rng';
import { WAR_KEY, clearWar, loadWar, saveWar, validateWar } from '../../src/world/storage';
import type { War } from '../../src/world/types';

const data = buildWorldData(rawWorldData);
const game = getGameData();
const make = () => createWar(data, { seed: 41, heroId: 'paladin', heroName: 'Ivy' });

function store(): { map: Map<string, string>; storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } } {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: k => map.get(k) ?? null,
      setItem: (k, v) => { map.set(k, v); },
      removeItem: k => { map.delete(k); },
    },
  };
}

/** Advance a few real turns so the snapshot carries RNG, paths and log history. */
function played(): War {
  const war = make();
  for (let t = 0; t < 3 && war.phase === 'orders'; t++) {
    for (const d of war.divisions) {
      const next = data.neighbours.get(d.atNode)!;
      issueOrder(war, { type: 'march', division: d.id, toNode: next[t % next.length]! });
    }
    resolveTurn(war);
    // resolveTurn mutates phase, which TypeScript cannot see through the loop guard.
    if ((war.phase as War['phase']) === 'admin') war.phase = 'orders';
  }
  return war;
}

describe('war persistence', () => {
  it('reports no save, then round-trips a played war to an identical hash', () => {
    const { storage } = store();
    expect(loadWar(storage, data, game)).toEqual({ kind: 'none' });
    const war = played();
    saveWar(storage, war);
    const loaded = loadWar(storage, data, game);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(hashWar(loaded.state)).toBe(hashWar(war));
    expect(loaded.state.turnLog).toEqual(war.turnLog);
    expect(internal(loaded.state).rng).toEqual(internal(war).rng);
    expect(internal(loaded.state).supply).toEqual(internal(war).supply);
    expect(internal(loaded.state).paths).toEqual(internal(war).paths);
  });

  it('resumes the restored war identically to the original', () => {
    const { storage } = store();
    const war = played();
    saveWar(storage, war);
    const loaded = loadWar(storage, data, game);
    if (loaded.kind !== 'ok') throw new Error('expected a loadable save');
    for (const target of [war, loaded.state]) {
      for (const d of target.divisions) issueOrder(target, { type: 'hold', division: d.id });
      resolveTurn(target);
    }
    expect(hashWar(loaded.state)).toBe(hashWar(war));
  });

  it('keeps a suspended battle and its committed turn frame across a reload', () => {
    const { storage } = store();
    const war = make();
    const [a, b] = war.divisions;
    a!.atNode = 'greenfield'; b!.atNode = 'greenfield';
    for (const g of war.generals) if (a!.generals.includes(g.id) || b!.generals.includes(g.id)) g.nodeId = 'greenfield';
    for (const d of war.divisions) issueOrder(war, { type: 'hold', division: d.id });
    resolveTurn(war);
    expect(war.phase).toBe('battle');
    expect(war.pendingBattle).not.toBeNull();
    saveWar(storage, war);
    const loaded = loadWar(storage, data, game);
    if (loaded.kind !== 'ok') throw new Error('expected a loadable save');
    expect(loaded.state.pendingBattle).toEqual(war.pendingBattle);
    expect(internal(loaded.state).activeTurn).toEqual(internal(war).activeTurn);
    expect(hashWar(loaded.state)).toBe(hashWar(war));
  });

  it('reports a corrupt save without rewriting the stored bytes', () => {
    const { map, storage } = store();
    map.set(WAR_KEY, '{ not json');
    const first = loadWar(storage, data, game);
    expect(first.kind).toBe('corrupt');
    expect(map.get(WAR_KEY)).toBe('{ not json');
    const war = played();
    saveWar(storage, war);
    const bytes = map.get(WAR_KEY)!;
    map.set(WAR_KEY, bytes.replace(/"turn":\d+/, '"turn":-4'));
    const broken = map.get(WAR_KEY)!;
    expect(loadWar(storage, data, game).kind).toBe('corrupt');
    expect(map.get(WAR_KEY)).toBe(broken);
  });

  it('rejects semantically invalid saves that still satisfy the schema', () => {
    const war = played();
    const cases: [string, (w: War) => void][] = [
      ['unknown node owner', w => { w.nodes[0]!.owner = 'ghost-faction'; }],
      ['division on a missing node', w => { w.divisions[0]!.atNode = 'nowhere'; }],
      ['division holding a foreign general', w => { w.divisions[0]!.generals = [w.generals.find(g => g.factionId !== w.divisions[0]!.factionId)!.id]; }],
      ['division holding a missing general', w => { w.divisions[0]!.generals = ['general-ghost']; }],
      ['duplicate general id', w => { w.generals.push({ ...w.generals[0]!, troops: [] }); }],
      ['duplicate troop id across generals', w => {
        const troop = w.generals.find(g => g.troops.length)!.troops[0]!;
        w.generals.find(g => g.troops.length && !g.troops.includes(troop))!.troops.push({ ...troop });
      }],
      ['unknown general profile', w => { w.generals[0]!.generalId = 'not-a-general' as never; }],
      ['unknown troop species', w => { w.generals.find(g => g.troops.length)!.troops[0]!.unitId = 'not-a-species'; }],
      ['troop level inconsistent with xp', w => { w.generals.find(g => g.troops.length)!.troops[0]!.level = 9; }],
      ['general over command capacity', w => { const g = w.generals.find(x => x.troops.length)!; g.capacity = 1; }],
      ['hp above max', w => { w.generals[0]!.hp = w.generals[0]!.maxHp + 10; }],
      ['division over the attacker cap', w => { w.divisions[0]!.generals = w.generals.filter(g => g.factionId === w.divisions[0]!.factionId).map(g => g.id); }],
      ['altered authored map topology', w => { w.nodes[0]!.owner = 'ghost-faction'; w.divisions[0]!.atNode = 'nowhere'; }],
      ['pending battle naming a missing division', w => {
        w.phase = 'battle';
        w.pendingBattle = { id: 'b', cause: 'contact', nodeId: w.divisions[0]!.atNode, attacker: 'division-ghost', defender: null, wild: [], processedSkirmishIds: [] };
      }],
      ['battle phase without a pending battle', w => { w.phase = 'battle'; w.pendingBattle = null; }],
      ['captive that no general matches', w => { w.factions[0]!.captives = ['general-ghost']; }],
      ['supply for an unknown node', w => { internal(w).supply = { ...internal(w).supply, nowhere: 3 }; }],
      ['active frame naming a missing division', w => {
        internal(w).activeTurn = { turn: w.turn, orders: [{ type: 'hold', division: 'division-ghost' }], starts: {}, resolved: [], ordinal: 0, current: null };
      }],
      ['no player hero', w => { for (const g of w.generals) g.isHero = false; }],
    ];
    for (const [label, mutate] of cases) {
      const { map, storage } = store();
      saveWar(storage, war);
      const snapshot = JSON.parse(map.get(WAR_KEY)!);
      const copy = loadWar(storage, data, game);
      if (copy.kind !== 'ok') throw new Error(`baseline save must load, got ${copy.kind}`);
      mutate(copy.state);
      saveWar(storage, copy.state);
      const bytes = map.get(WAR_KEY)!;
      const result = loadWar(storage, data, game);
      expect(result.kind, label).toBe('corrupt');
      expect(map.get(WAR_KEY), label).toBe(bytes);
      expect(snapshot.turn).toBe(war.turn);
    }
  });

  it('rebuilds authored topology instead of trusting the save, and rejects a forged map in memory', () => {
    const { storage } = store();
    const war = played();
    saveWar(storage, war);
    const loaded = loadWar(storage, data, game);
    if (loaded.kind !== 'ok') throw new Error('expected a loadable save');
    // Topology is not persisted at all, so a tampered in-memory map cannot survive a round trip.
    loaded.state.routes.push({ id: 'invented', from: 'dawnkeep', to: 'nightspire' });
    expect(() => validateWar(data, game, loaded.state)).toThrow(/route count/);
    saveWar(storage, loaded.state);
    const reloaded = loadWar(storage, data, game);
    expect(reloaded.kind).toBe('ok');
    if (reloaded.kind !== 'ok') return;
    expect(reloaded.state.routes.map(r => r.id).sort()).toEqual(data.routes.map(r => r.id).sort());
    expect(reloaded.state.routes.some(r => r.id === 'invented')).toBe(false);
  });

  it('accepts a legitimately progressed save and clears on request', () => {
    const { map, storage } = store();
    const war = played();
    const veteran = war.generals.find(g => g.troops.length)!;
    const units = Object.fromEntries(game.unitById) as Parameters<typeof awardTroopXp>[2];
    // Progress the troop through the real XP helper so level and species stay consistent.
    veteran.troops[0] = awardTroopXp(veteran.troops[0]!, 250, units);
    expect(veteran.troops[0]!.level).toBeGreaterThan(1);
    veteran.hp = Math.floor(veteran.maxHp / 2);
    veteran.injuredTurns = 2;
    expect(() => validateWar(data, game, war)).not.toThrow();
    saveWar(storage, war);
    const loaded = loadWar(storage, data, game);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') {
      const restored = loaded.state.generals.find(g => g.id === veteran.id)!;
      expect(restored.troops[0]).toEqual(veteran.troops[0]);
      expect(restored.injuredTurns).toBe(2);
    }
    clearWar(storage);
    expect(map.has(WAR_KEY)).toBe(false);
    expect(loadWar(storage, data, game)).toEqual({ kind: 'none' });
  });
});
