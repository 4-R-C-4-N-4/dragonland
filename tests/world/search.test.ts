import { describe, expect, it } from 'vitest';
import { buildWorldData, rawWorldData } from '../../src/world/data';
import { createWar } from '../../src/world/engine';
import { internal } from '../../src/world/rng';
import { searchOutcome, wildEncounter, applyWildVictory } from '../../src/world/search';

const data = buildWorldData(rawWorldData);
const setup = { seed: 17, heroId: 'paladin' as const, heroName: 'Ivy' };
function at(seed: number, node = 'greenfield') {
  const war = createWar(data, { ...setup, seed });
  const division = war.divisions.find(d => d.factionId === 'player')!;
  division.atNode = node;
  return { war, division };
}

describe('biome search and wild recruitment', () => {
  it('is deterministic for the same seed and differs for another seed', () => {
    const a = at(10), b = at(10);
    expect(searchOutcome(a.war, a.division.id)).toEqual(searchOutcome(b.war, b.division.id));
    const baseline = at(10);
    const expected = searchOutcome(baseline.war, baseline.division.id);
    const differs = Array.from({ length: 100 }, (_, i) => at(i + 1)).some(({ war, division }) => JSON.stringify(searchOutcome(war, division.id)) !== JSON.stringify(expected));
    expect(differs).toBe(true);
  });
  it('uses measurably different lair and wilderness rates over a seeded ensemble', () => {
    let lair = 0, wild = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const a = at(seed, 'wyrmpeak'), b = at(seed, 'greenfield');
      lair += Number(searchOutcome(a.war, a.division.id).kind === 'wild');
      wild += Number(searchOutcome(b.war, b.division.id).kind === 'wild');
    }
    expect(lair / 400).toBeGreaterThan(wild / 400 + 0.2);
  });
  it('returns nothing at a friendly settlement', () => {
    const { war, division } = at(1, 'westmere');
    expect(searchOutcome(war, division.id)).toEqual({ kind: 'nothing' });
  });
  it('only yields species authored for the node biome', () => {
    const allowed = new Set(data.biomes.plains!.map(entry => entry.unitId));
    for (let seed = 1; seed <= 100; seed++) {
      const { war, division } = at(seed);
      const result = searchOutcome(war, division.id);
      if (result.kind === 'wild') expect(allowed.has(result.wild[0]!.unitId)).toBe(true);
    }
  });
  it('clamps recruits to command capacity and discards the surplus', () => {
    const { war, division } = at(2);
    const general = war.generals.find(g => g.id === division.generals[0])!;
    general.capacity = general.troops.length + 2;
    const before = general.troops.length;
    applyWildVictory(war, division.id, general.id, [{ unitId: 'dog', count: 9 }]);
    expect(general.troops).toHaveLength(before + 2);
    expect(general.troops.slice(before)).toMatchObject([{ unitId: 'dog', xp: 0, level: 1 }, { unitId: 'dog', xp: 0, level: 1 }]);
  });
  it('adds no troops on a loss', () => {
    const { war, division } = at(3);
    const before = structuredClone(war.generals);
    applyWildVictory(war, division.id, division.generals[0]!, []);
    expect(war.generals).toEqual(before);
  });
  it('keeps recruited ids and names unique against every roster', () => {
    const { war, division } = at(4);
    applyWildVictory(war, division.id, division.generals[0]!, [{ unitId: 'dog', count: 8 }]);
    const troops = war.generals.flatMap(g => g.troops);
    expect(new Set(troops.map(t => t.id)).size).toBe(troops.length);
    expect(new Set(troops.map(t => t.name)).size).toBe(troops.length);
  });
  it('rejects invalid division, unknown faction and empty non-settled biome table without mutation', () => {
    const { war, division } = at(5);
    const before = structuredClone(war);
    expect(() => searchOutcome(war, 'missing')).toThrow();
    expect(war).toEqual(before);
    division.factionId = 'ghost-faction';
    expect(() => searchOutcome(war, division.id)).toThrow(/unknown faction/);
    division.factionId = 'player';
    division.generals = [];
    expect(() => searchOutcome(war, division.id)).toThrow();
    division.generals = before.divisions.find(d => d.id === division.id)!.generals;
    division.atNode = 'westmere';
    war.nodes.find(n => n.id === 'westmere')!.biome = 'plains';
    internal(war).data.biomes.plains = [];
    const snapshot = structuredClone(war);
    expect(() => searchOutcome(war, division.id)).toThrow();
    expect(war).toEqual(snapshot);
  });
  it('lets any faction search, not only the player', () => {
    const { war } = at(5);
    const enemy = war.divisions.find(d => d.factionId !== 'player' && d.generals.length)!;
    enemy.atNode = 'highpass';
    expect(() => searchOutcome(war, enemy.id)).not.toThrow();
    const found = Array.from({ length: 200 }, (_, i) => {
      const w = createWar(data, { ...setup, seed: i + 1 });
      const d = w.divisions.find(x => x.factionId !== 'player' && x.generals.length)!;
      d.atNode = 'wyrmpeak';
      return searchOutcome(w, d.id).kind === 'wild';
    }).filter(Boolean).length;
    expect(found).toBeGreaterThan(0);
  });
  it('gives two allied divisions searching one node distinct battle identities', () => {
    const { war, division } = at(7);
    const second = { ...structuredClone(division), id: 'division-second' };
    war.divisions.push(second);
    const wild = [{ unitId: 'dog', count: 2 }];
    const first = wildEncounter(war, division.id, wild);
    const other = wildEncounter(war, second.id, wild);
    expect(first.id).not.toBe(other.id);
    expect(first.attacker).toBe(division.id);
    expect(other.attacker).toBe(second.id);
  });
  it('consumes exactly one RNG draw per search', () => {
    const { war, division } = at(6);
    const state = internal(war).rng.state;
    searchOutcome(war, division.id);
    // One mulberry32 step is one increment by this constant.
    expect(internal(war).rng.state).toBe((state + 0x6d2b79f5) >>> 0);
  });
  it('creates a wild pending battle with deterministic turn and node identity', () => {
    const a = at(9), b = at(9);
    const wild = [{ unitId: 'dog', count: 3 }];
    expect(wildEncounter(a.war, a.division.id, wild)).toEqual(wildEncounter(b.war, b.division.id, wild));
    expect(wildEncounter(a.war, a.division.id, wild)).toMatchObject({ cause: 'wild', nodeId: 'greenfield', attacker: a.division.id, defender: null, wild });
  });
});
