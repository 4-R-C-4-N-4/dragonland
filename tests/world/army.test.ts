import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, step } from '../../src/sim';
import { buildWorldData, createWar, rawWorldData, wildBattleSetup, wildEncounter, applyWildResult, leaveAsGarrison } from '../../src/world';
import { fightPool, type WarArmy } from '../../src/world/army';
import { applySkirmishResult, commitAttacker, commitDefender, sequenceEncounter, snapshotBattleResult } from '../../src/world/sequence';
import { internal } from '../../src/world/rng';

const data = buildWorldData(rawWorldData);
const game = getGameData();
const make = () => createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
const ownDivision = (war: ReturnType<typeof make>) => war.divisions.find(d => d.factionId === 'player')!;
const ids = (xs: { id: string }[]) => xs.map(x => x.id).sort();

/** A plan taking the first `n` pool troops of each listed species into one squad per species. */
function plan(pool: { id: string; unitId: string }[], perSpecies: Record<string, number>, formationId = game.formations[1]!.id): WarArmy {
  return {
    formationId,
    squads: Object.entries(perSpecies).map(([unitId, n], i) => ({ name: `S${i}`, disposition: i === 0 ? 'fierce' : 'guard', troopIds: pool.filter(t => t.unitId === unitId).slice(0, n).map(t => t.id) })),
  };
}

/** Contact between the player's division (attacker) and the rival's first field division. */
function contact(war: ReturnType<typeof make>) {
  const own = ownDivision(war);
  const foe = war.divisions.find(d => d.factionId !== 'player')!;
  war.pendingBattle = { id: 'battle-army', cause: 'contact', nodeId: own.atNode, attacker: own.id, defender: foe.id, wild: [], processedSkirmishIds: [] };
  war.phase = 'battle';
  return { own, foe, seq: sequenceEncounter(war, war.pendingBattle) };
}

describe('division troop pools', () => {
  it('pools every troop held by the generals of the division', () => {
    const war = make(); const own = ownDivision(war);
    const all = own.generals.flatMap(id => war.generals.find(g => g.id === id)!.troops);
    for (const id of own.generals) expect(ids(fightPool(war, id))).toEqual(ids(all));
  });

  it('pools a castle garrison separately from the division that left it', () => {
    const war = make(); const own = ownDivision(war);
    const stay = own.generals[2]!;
    leaveAsGarrison(war, own.id, stay);
    expect(ids(fightPool(war, stay))).toEqual(ids(war.generals.find(g => g.id === stay)!.troops));
    expect(fightPool(war, own.generals[0]!).some(t => war.generals.find(g => g.id === stay)!.troops.includes(t))).toBe(false);
  });
});

describe('fighting with a prepared army', () => {
  it('fields exactly the planned troops, squads, dispositions and formation, drawn from the whole pool', () => {
    const war = make(); const { own, foe, seq } = contact(war);
    const hero = war.generals.find(g => g.isHero)!;
    const pool = fightPool(war, hero.id);
    const before = ids(pool);
    const species = [...new Set(pool.map(t => t.unitId))];
    // More of one species than the hero personally holds: it has to come from the other generals.
    const army = plan(pool, { [species[0]!]: 10, [species[1]!]: 6 });
    commitDefender(war, seq, foe.generals[0]!);
    const selection = commitAttacker(war, seq, hero.id, army);
    const side = selection.setup.sides[1];
    expect(side.formationId).toBe(army.formationId);
    expect(side.squads.map(q => [q.disposition, q.troops.map(t => t.troopId).sort()])).toEqual(army.squads.map(q => [q.disposition, [...q.troopIds].sort()]));
    // The hero now holds the planned troops; nothing in the pool was lost or duplicated.
    for (const id of army.squads.flatMap(q => q.troopIds)) expect(hero.troops.some(t => t.id === id)).toBe(true);
    expect(ids(fightPool(war, hero.id))).toEqual(before);
    for (const id of own.generals) { const g = war.generals.find(x => x.id === id)!; expect(g.troops.length).toBeLessThanOrEqual(g.capacity); }
  });

  it('rejects plans the pool cannot field, without touching the war', () => {
    const war = make(); const { foe, seq } = contact(war);
    const hero = war.generals.find(g => g.isHero)!;
    const pool = fightPool(war, hero.id);
    const species = [...new Set(pool.map(t => t.unitId))];
    commitDefender(war, seq, foe.generals[0]!);
    const before = structuredClone(war.generals);
    const enemyTroop = war.generals.find(g => g.factionId !== 'player')!.troops[0]!.id;
    const bad: WarArmy[] = [
      { ...plan(pool, { [species[0]!]: 4 }), squads: [{ name: 'X', disposition: 'mixed', troopIds: [enemyTroop, pool[0]!.id] }] },
      { ...plan(pool, { [species[0]!]: 4 }), squads: [{ name: 'X', disposition: 'mixed', troopIds: [pool[0]!.id, pool[0]!.id] }] },
      plan(pool, { [species[0]!]: 2, [species[1]!]: 2, [species[2]!]: 2, [species[3]!]: 2, [species[4]!]: 2 }),
      plan(pool, { [species[0]!]: 4 }, 'no-such-formation'),
      { ...plan(pool, { [species[0]!]: 4 }), squads: [{ name: 'X', disposition: 'mixed', troopIds: [pool[0]!.id] }] },
    ];
    for (const army of bad) {
      expect(() => commitAttacker(war, seq, hero.id, army)).toThrow();
      expect(war.generals).toEqual(before);
      expect(seq.status).toBe('selecting-attacker');
    }
  });

  it('caps the fielded company at the general command limit', () => {
    const war = make(); const { foe, seq } = contact(war);
    const hero = war.generals.find(g => g.isHero)!;
    hero.capacity = 8;
    const pool = fightPool(war, hero.id);
    const species = [...new Set(pool.map(t => t.unitId))];
    commitDefender(war, seq, foe.generals[0]!);
    expect(() => commitAttacker(war, seq, hero.id, plan(pool, { [species[0]!]: 5, [species[1]!]: 5 }))).toThrow(/command|capacity/i);
  });

  it('keeps benched troops through a real fight and gives XP only to deployed survivors', () => {
    const war = make(); const { foe, seq } = contact(war);
    const hero = war.generals.find(g => g.isHero)!;
    const pool = fightPool(war, hero.id);
    const species = [...new Set(pool.map(t => t.unitId))];
    const army = plan(pool, { [species[0]!]: 3 });
    commitDefender(war, seq, foe.generals[0]!);
    const selection = commitAttacker(war, seq, hero.id, army);
    const deployed = new Set(army.squads.flatMap(q => q.troopIds));
    const benched = hero.troops.filter(t => !deployed.has(t.id)).map(t => ({ ...t }));
    const sim = createBattle(game, selection.setup);
    for (let i = 0; i < 200_000 && !sim.result; i++) step(sim);
    const snapshot = snapshotBattleResult(sim);
    applySkirmishResult(war, seq, selection.id, snapshot);
    const survivors = new Set(snapshot.result.survivors[1]);
    // Every benched troop is still there, untouched; deployed troops remain only if they survived.
    for (const b of benched) expect(hero.troops.find(t => t.id === b.id)).toEqual(b);
    for (const id of deployed) expect(hero.troops.some(t => t.id === id)).toBe(survivors.has(id));
    void internal;
  });

  it('lets AI sides fight with what each general holds, as before', () => {
    const war = make(); const { foe, seq } = contact(war);
    const rival = war.generals.find(g => g.id === foe.generals[0])!;
    commitDefender(war, seq, rival.id);
    const selection = commitAttacker(war, seq, war.generals.find(g => g.isHero)!.id);
    expect(selection.setup.sides[0].squads.flatMap(q => q.troops.map(t => t.troopId)).sort()).toEqual(ids(rival.troops));
  });
});

describe('wild fights with a prepared army', () => {
  it('fields the plan and keeps benched troops', () => {
    const war = make(); const own = ownDivision(war);
    own.atNode = 'reedhaven';
    for (const id of own.generals) war.generals.find(g => g.id === id)!.nodeId = 'reedhaven';
    war.pendingBattle = wildEncounter(war, own.id, [{ unitId: 'dog', count: 2 }]);
    war.phase = 'battle';
    const hero = war.generals.find(g => g.isHero)!;
    const pool = fightPool(war, hero.id);
    const species = [...new Set(pool.map(t => t.unitId))];
    const army = plan(pool, { [species[0]!]: 8, [species[1]!]: 8 });
    const selection = wildBattleSetup(war, own.id, hero.id, army);
    expect(selection.setup.sides[1].squads.flatMap(q => q.troops.map(t => t.troopId)).sort()).toEqual(army.squads.flatMap(q => q.troopIds).sort());
    const deployed = new Set(army.squads.flatMap(q => q.troopIds));
    const benched = hero.troops.filter(t => !deployed.has(t.id)).map(t => t.id);
    const sim = createBattle(game, selection.setup);
    for (let i = 0; i < 200_000 && !sim.result; i++) step(sim);
    applyWildResult(war, selection, snapshotBattleResult(sim));
    for (const id of benched) expect(hero.troops.some(t => t.id === id)).toBe(true);
  });
});
