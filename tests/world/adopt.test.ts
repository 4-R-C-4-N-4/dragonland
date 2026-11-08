import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { adoptCaptive, buildWorldData, createWar, loadWar, rawWorldData, saveWar } from '../../src/world';

const data = buildWorldData(rawWorldData);
const make = () => {
  const war = createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
  const player = war.factions.find(f => f.isPlayer)!;
  const rival = war.factions.find(f => !f.isPlayer)!;
  const own = war.divisions.find(d => d.factionId === player.id)!;
  // A rival general beaten at 0 HP, captured, removed from its division, now held by the player.
  const field = war.divisions.find(d => d.factionId === rival.id)!;
  const captive = war.generals.find(g => g.id === field.generals[0])!;
  field.generals = field.generals.filter(id => id !== captive.id);
  captive.hp = 0; captive.nodeId = own.atNode; captive.troops = captive.troops.slice(0, 12);
  player.captives.push(captive.id);
  return { war, player, rival, own, captive };
};

describe('adoptCaptive', () => {
  it('turns a captured rival into a general in the chosen division', () => {
    const { war, player, own, captive } = make();
    const troops = captive.troops.map(t => t.id);
    adoptCaptive(war, player.id, captive.id, own.id);
    expect(captive.factionId).toBe(player.id);
    expect(own.generals).toContain(captive.id);
    expect(captive.nodeId).toBe(own.atNode);
    expect(player.captives).not.toContain(captive.id);
    // Keeps its surviving troops (its own classes) and returns with a share of its HP.
    expect(captive.troops.map(t => t.id)).toEqual(troops);
    expect(captive.hp).toBe(Math.ceil(captive.maxHp * data.constants.ADOPTED_HP_FRAC));
    expect(captive.injuredTurns).toBe(0);
  });

  it('keeps a captive that still had HP at that HP', () => {
    const { war, player, own, captive } = make();
    captive.hp = captive.maxHp * 0.9;
    adoptCaptive(war, player.id, captive.id, own.id);
    expect(captive.hp).toBe(captive.maxHp * 0.9);
  });

  it('survives a save and reload', () => {
    const { war, player, own, captive } = make();
    adoptCaptive(war, player.id, captive.id, own.id);
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    saveWar(storage, war);
    const loaded = loadWar(storage, data, getGameData());
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') expect(loaded.state.divisions.find(d => d.id === own.id)!.generals).toContain(captive.id);
  });

  it('rejects illegal adoptions without changing anything', () => {
    const { war, player, rival, own, captive } = make();
    const before = structuredClone(war);
    const rivalDivision = war.divisions.find(d => d.factionId === rival.id)!;
    expect(() => adoptCaptive(war, player.id, 'nobody', own.id)).toThrow(/captive/i);
    expect(() => adoptCaptive(war, player.id, captive.id, rivalDivision.id)).toThrow(/division/i);
    own.generals.push(...Array.from({ length: data.constants.MAX_DIVISION_GENERALS - 1 }, (_, i) => `filler-${i}`));
    expect(() => adoptCaptive(war, player.id, captive.id, own.id)).toThrow(/room|at most/i);
    own.generals = [...before.divisions.find(d => d.id === own.id)!.generals];
    war.phase = 'battle';
    expect(() => adoptCaptive(war, player.id, captive.id, own.id)).toThrow(/battle/i);
    war.phase = 'orders';
    expect(war).toEqual(before);
  });

  it('is allowed during the weekly muster', () => {
    const { war, player, own, captive } = make();
    war.phase = 'admin';
    adoptCaptive(war, player.id, captive.id, own.id);
    expect(own.generals).toContain(captive.id);
  });
});
