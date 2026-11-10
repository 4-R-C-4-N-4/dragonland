import { describe, expect, it } from 'vitest';
import { buildWorldData, createWar, rawWorldData, leaveAsGarrison, adoptCaptive, applyWildVictory } from '../../src/world';
import { applyGarrisonUpkeep, applyRest, resetWeeklySupply } from '../../src/world/upkeep';
import { musterOf } from '../../src/world/muster';

const data = buildWorldData(rawWorldData);
const make = () => createWar(data, { seed: 17, heroId: 'warg', heroName: 'Ivy' });
const own = (war: ReturnType<typeof make>) => war.divisions.find(d => d.factionId === 'player')!;
const held = (war: ReturnType<typeof make>, d: ReturnType<typeof own>) => d.generals.reduce((n, id) => n + war.generals.find(g => g.id === id)!.troops.length, 0);
/** Kill `n` troops spread over the division, as a lost fight would. */
function lose(war: ReturnType<typeof make>, d: ReturnType<typeof own>, n: number) {
  for (let i = 0; n > 0; i++) { const g = war.generals.find(x => x.id === d.generals[i % d.generals.length])!; if (g.troops.length) { g.troops.pop(); n--; } }
}

describe('muster strength', () => {
  it('starts at the opening army for every division', () => {
    const war = make();
    for (const d of war.divisions) expect(musterOf(war, d)).toBe(held(war, d));
    expect(musterOf(war, own(war))).toBe(60);
  });

  it('is not lowered by losses, but drops when a general leaves with its troops', () => {
    const war = make(); const d = own(war);
    lose(war, d, 25);
    expect(musterOf(war, d)).toBe(60);
    const leaver = war.generals.find(g => g.id === d.generals[2])!;
    const taking = leaver.troops.length;
    leaveAsGarrison(war, d.id, leaver.id);
    expect(musterOf(war, d)).toBe(60 - taking);
  });

  it('rises with wild recruits and adopted generals', () => {
    const war = make(); const d = own(war);
    d.atNode = 'reedhaven'; for (const id of d.generals) war.generals.find(g => g.id === id)!.nodeId = 'reedhaven';
    applyWildVictory(war, d.id, d.generals[0]!, [{ unitId: 'dog', count: 5 }]);
    expect(musterOf(war, d)).toBe(65);
    const rival = war.generals.find(g => g.factionId !== 'player' && !war.divisions.some(x => x.generals.includes(g.id)))!;
    war.factions.find(f => f.id === 'player')!.captives.push(rival.id);
    adoptCaptive(war, 'player', rival.id, d.id);
    expect(musterOf(war, d)).toBe(65 + rival.troops.length);
  });
});

describe('castle garrisons', () => {
  it('heal, refill MP and recruit from the castle each turn, sharing its weekly stock', () => {
    const war = make(); const d = own(war);
    const g = war.generals.find(x => x.id === d.generals[2])!;
    leaveAsGarrison(war, d.id, g.id);
    g.troops = g.troops.slice(0, 5); g.hp = 100; g.mp = 0;
    applyGarrisonUpkeep(war);
    expect(g.troops.length).toBe(65);
    expect(g.hp).toBe(100 + g.maxHp * 0.25);
    expect(g.mp).toBe(100);
    applyGarrisonUpkeep(war);
    expect(g.troops.length).toBe(65);
  });

  it('do nothing in towns or for injured generals', () => {
    const war = make(); const d = own(war);
    d.atNode = 'westmere'; for (const id of d.generals) war.generals.find(x => x.id === id)!.nodeId = 'westmere';
    const g = war.generals.find(x => x.id === d.generals[2])!;
    leaveAsGarrison(war, d.id, g.id);
    g.troops = [];
    applyGarrisonUpkeep(war);
    expect(g.troops).toEqual([]);
  });
});

describe('resting refills losses', () => {
  it('brings a town-resting division back to its muster in one rest', () => {
    const war = make(); const d = own(war);
    d.atNode = 'westmere';
    lose(war, d, 25);
    applyRest(war, d);
    expect(held(war, d)).toBe(60);
    for (const id of d.generals) { const g = war.generals.find(x => x.id === id)!; expect(g.troops.length).toBeLessThanOrEqual(g.capacity); }
    expect(war.events.filter(e => e.type === 'resupplied').reduce((n, e) => n + (e as { troops: number }).troops, 0)).toBe(25);
  });

  it('recruits beyond the muster in a castle, raising it, but only refills in a town', () => {
    const war = make(); const d = own(war);
    applyRest(war, d);
    expect(held(war, d)).toBe(120);
    expect(musterOf(war, d)).toBe(120);
    applyRest(war, d);
    expect(held(war, d)).toBe(120);
    const town = make(); const t = own(town);
    t.atNode = 'westmere';
    applyRest(town, t);
    expect(held(town, t)).toBe(60);
  });

  it('is limited by the node\u2019s weekly stock: 60 at a castle, 30 at a town', () => {
    const war = make(); const d = own(war);
    d.generals.forEach(id => { war.generals.find(g => g.id === id)!.troops = []; });
    applyRest(war, d); expect(held(war, d)).toBe(60);
    d.generals.forEach(id => { war.generals.find(g => g.id === id)!.troops = []; });
    applyRest(war, d); expect(held(war, d)).toBe(0);
    d.muster = 60;
    resetWeeklySupply(war);
    d.atNode = 'westmere';
    applyRest(war, d); expect(held(war, d)).toBe(30);
  });

  it('refills MP to full', () => {
    const war = make(); const d = own(war);
    for (const id of d.generals) war.generals.find(g => g.id === id)!.mp = 10;
    applyRest(war, d);
    for (const id of d.generals) expect(war.generals.find(g => g.id === id)!.mp).toBe(100);
  });
});
