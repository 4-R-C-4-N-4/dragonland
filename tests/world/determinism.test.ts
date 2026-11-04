import { describe, expect, it } from 'vitest';
import { buildWorldData, rawWorldData } from '../../src/world/data';
import { createWar, hashWar, issueOrder, resolveTurn, replayWar } from '../../src/world';
const data = buildWorldData(rawWorldData);
const setup = { seed: 17, heroId: 'paladin' as const, heroName: 'Ivy' };
describe('war hash and orders', () => {
  it('hashes stable state and detects position, previous node, HP, troops, ownership and clock changes', () => {
    const war = createWar(data, setup);
    const hash = hashWar(war);
    expect(hashWar(war)).toBe(hash);
    for (const change of [
      (w: typeof war) => { w.divisions[0]!.atNode = 'westmere'; },
      (w: typeof war) => { w.divisions[0]!.previousNode = 'westmere'; },
      (w: typeof war) => { w.generals[0]!.hp--; },
      (w: typeof war) => { w.generals[0]!.troops.pop(); },
      (w: typeof war) => { w.nodes[0]!.owner = null; },
      (w: typeof war) => { w.turn++; },
      (w: typeof war) => { w.week++; },
      (w: typeof war) => { w.phase = 'battle'; },
    ]) { const copy = structuredClone(war); change(copy); expect(hashWar(copy)).not.toBe(hash); }
  });
  it('queues only the latest order per division without changing anything else', () => {
    const war = createWar(data, setup);
    const before = structuredClone(war);
    const id = war.divisions[0]!.id;
    issueOrder(war, { type: 'rest', division: id });
    issueOrder(war, { type: 'hold', division: id });
    expect((war._internal as { pending: unknown[] }).pending).toEqual([{ type: 'hold', division: id }]);
    (before._internal as { pending: unknown[] }).pending = [{ type: 'hold', division: id }];
    expect(war).toEqual(before);
  });
  it('rejects an unknown division atomically', () => {
    const war = createWar(data, setup); const before = structuredClone(war);
    expect(() => issueOrder(war, { type: 'hold', division: 'missing' })).toThrow(/missing/);
    expect(war).toEqual(before);
  });
});


describe('war replay and simultaneous fairness', () => {
  it('replays 30 scripted turns exactly, including weekly pauses and fresh troops', () => {
    const scripted = (seed: number) => {
      const war = createWar(data, { ...setup, seed });
      const player = war.divisions.find(d => d.factionId === 'player')!;
      const rival = war.divisions.find(d => d.factionId === 'invader')!;
      for (let i = 0; i < 30; i++) {
        if (war.phase === 'admin') war.phase = 'orders';
        const p = ['rest', 'reedhaven', 'stoneford', 'reedhaven', 'dawnkeep'][i % 5]!;
        const r = ['rest', 'eastgate', 'pinewatch', 'eastgate', 'nightspire'][i % 5]!;
        for (const [d, to] of [[player, p], [rival, r]] as const) issueOrder(war, to === 'rest' ? { type: 'rest', division: d.id } : { type: 'march', division: d.id, toNode: to });
        resolveTurn(war);
      }
      return war;
    };
    const war = scripted(setup.seed);
    expect(war.turnLog).toHaveLength(30); expect(war.turn).toBe(31);
    const replayed = replayWar(data, setup, war.turnLog, 30);
    expect(hashWar(replayed)).toBe(hashWar(war));
    expect(replayed).toEqual(war);
    const other = scripted(18);
    expect(other.turn).toBe(war.turn);
    expect(hashWar(replayWar(data, { ...setup, seed: 18 }, other.turnLog, 30))).toBe(hashWar(other));
    expect(hashWar(other)).not.toBe(hashWar(war));
  });
  it('preserves a final admin boundary and obeys the replay limit', () => {
    const war = createWar(data, setup); for (let i = 0; i < 7; i++) resolveTurn(war);
    expect(replayWar(data, setup, war.turnLog, 7)).toEqual(war);
    expect(replayWar(data, setup, war.turnLog, 3).turn).toBe(4);
  });
  it('shuffling queued orders and faction arrays cannot change a resolved swap', () => {
    const war = createWar(data, setup); const [a, b] = war.divisions;
    a!.atNode = 'greenfield'; b!.atNode = 'pinewatch';
    issueOrder(war, { type: 'march', division: a!.id, toNode: 'pinewatch' });
    issueOrder(war, { type: 'march', division: b!.id, toNode: 'greenfield' });
    const copy = structuredClone(war);
    (copy._internal as { pending: unknown[] }).pending.reverse(); copy.factions.reverse(); copy.divisions.reverse();
    resolveTurn(war); resolveTurn(copy);
    expect(hashWar(copy)).toBe(hashWar(war)); expect(copy.pendingBattle).toEqual(war.pendingBattle); expect(copy.events).toEqual(war.events);
  });
  it('symmetric identical forces show no faction-0 initiative bias over 128 seeds', () => {
    const template = structuredClone(rawWorldData) as { world: typeof data; constants: unknown };
    template.world.nodes = [
      { ...data.nodes[0]!, id: 'left', owner: 'player', x: -1 },
      { ...data.nodes[0]!, id: 'right', owner: 'invader', x: 1 },
      { ...data.nodes[2]!, id: 'center', owner: null, x: 0 },
    ];
    template.world.routes = [{ id: 'l', from: 'left', to: 'center' }, { id: 'r', from: 'right', to: 'center' }];
    template.world.factions.forEach(f => { f.classes = ['human']; f.personality = 'aggressive'; });
    const mirroredData = buildWorldData(template);
    const counts = [0, 0];
    for (let seed = 0; seed < 128; seed++) {
      const war = createWar(mirroredData, { ...setup, seed });
      const p = war.divisions.find(d => d.factionId === 'player')!; const r = war.divisions.find(d => d.factionId === 'invader')!;
      // Give both armies exactly the same general profiles, HP and troop counts.
      const pg = war.generals.filter(g => p.generals.includes(g.id));
      const rg = pg.map((g, i) => ({ ...structuredClone(g), id: `mirror-${i}`, factionId: 'invader', isHero: false, nodeId: 'right' }));
      war.generals = [...pg, ...rg]; r.generals = rg.map(g => g.id);
      for (const d of [p, r]) issueOrder(war, { type: 'march', division: d.id, toNode: 'center' });
      resolveTurn(war);
      expect(war.pendingBattle?.cause).toBe('contact');
      expect(p.atNode).toBe('center'); expect(r.atNode).toBe('center');
      counts[war.pendingBattle!.attacker === p.id ? 0 : 1]!++;
      const flipped = createWar(mirroredData, { ...setup, seed });
      flipped.generals = structuredClone([...pg, ...rg]); flipped.divisions = structuredClone([p, r]);
      flipped.divisions.forEach(d => { d.atNode = d.factionId === 'player' ? 'left' : 'right'; d.previousNode = null; });
      flipped.factions.reverse(); flipped.divisions.reverse();
      for (const d of flipped.divisions) issueOrder(flipped, { type: 'march', division: d.id, toNode: 'center' });
      resolveTurn(flipped);
      expect(flipped.pendingBattle).toEqual(war.pendingBattle);
    }
    expect(counts[0]).toBeGreaterThan(44); expect(counts[1]).toBeGreaterThan(44);
  });
});
