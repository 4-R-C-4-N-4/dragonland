import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, step } from '../../src/sim';
import { buildWorldData, createWar, rawWorldData, wildBattleSetup, wildEncounter, applyWildResult } from '../../src/world';
import { applySkirmishResult, commitAttacker, commitDefender, sequenceEncounter, snapshotBattleResult } from '../../src/world/sequence';
import { campaignBattlePerspective } from '../../src/ui/world/battlePerspective';
import { mpOf } from '../../src/world/mp';

const data = buildWorldData(rawWorldData);
const game = getGameData();
const make = () => createWar(data, { seed: 17, heroId: 'warg', heroName: 'Ivy' });

function run(setup: Parameters<typeof createBattle>[1]) {
  const sim = createBattle(game, setup);
  for (let i = 0; i < 200_000 && !sim.result; i++) step(sim);
  return sim;
}

describe('MP carried across battles', () => {
  it('starts every general of a new war at full MP', () => {
    const war = make();
    for (const g of war.generals) expect(mpOf(g)).toBe(game.generalById.get(g.generalId)!.mp);
  });

  it('starts a battle from the stored MP, clamped, and empty when not given', () => {
    const war = make();
    const own = war.divisions.find(d => d.factionId === 'player')!;
    const foe = war.divisions.find(d => d.factionId !== 'player')!;
    war.pendingBattle = { id: 'b', cause: 'contact', nodeId: own.atNode, attacker: own.id, defender: foe.id, wild: [], processedSkirmishIds: [] };
    war.phase = 'battle';
    const seq = sequenceEncounter(war, war.pendingBattle);
    const hero = war.generals.find(g => g.isHero)!;
    hero.mp = 37;
    commitDefender(war, seq, foe.generals[0]!);
    const sel = commitAttacker(war, seq, hero.id);
    expect(sel.setup.sides[1].startMp).toBe(37);
    expect(sel.setup.sides[0].startMp).toBe(100);
    expect(createBattle(game, sel.setup).generals[1].mp).toBe(37);
    expect(createBattle(game, { ...sel.setup, sides: [{ ...sel.setup.sides[0], startMp: 1e9 }, { ...sel.setup.sides[1], startMp: undefined }] }).generals.map(g => g.mp)).toEqual([100, 0]);
  });

  it('stores what is left after a clash, through the player\u2019s perspective swap', () => {
    const war = make();
    const own = war.divisions.find(d => d.factionId === 'player')!;
    const foe = war.divisions.find(d => d.factionId !== 'player')!;
    war.pendingBattle = { id: 'b', cause: 'contact', nodeId: own.atNode, attacker: own.id, defender: foe.id, wild: [], processedSkirmishIds: [] };
    war.phase = 'battle';
    const seq = sequenceEncounter(war, war.pendingBattle);
    const hero = war.generals.find(g => g.isHero)!;
    const rival = war.generals.find(g => g.id === foe.generals[0])!;
    hero.mp = 20; rival.mp = 60;
    commitDefender(war, seq, rival.id);
    const sel = commitAttacker(war, seq, hero.id);
    const view = campaignBattlePerspective(sel.setup, 1);
    const sim = run(view.setup);
    expect(sim.generals[0].def.id).toBe(hero.generalId);
    const snapshot = view.snapshot(sim);
    expect(snapshot.generalMp).toEqual([sim.generals[1].mp, sim.generals[0].mp]);
    applySkirmishResult(war, seq, sel.id, snapshot);
    expect(hero.mp).toBe(sim.generals[0].mp);
    expect(rival.mp).toBe(sim.generals[1].mp);
  });

  it('stores the searcher\u2019s MP after a wild fight', () => {
    const war = make();
    const own = war.divisions.find(d => d.factionId === 'player')!;
    own.atNode = 'reedhaven';
    for (const id of own.generals) war.generals.find(g => g.id === id)!.nodeId = 'reedhaven';
    war.pendingBattle = wildEncounter(war, own.id, [{ unitId: 'dog', count: 2 }]);
    war.phase = 'battle';
    const hero = war.generals.find(g => g.isHero)!;
    hero.mp = 5;
    const sel = wildBattleSetup(war, own.id, hero.id);
    expect(sel.setup.sides[1].startMp).toBe(5);
    const sim = run(sel.setup);
    applyWildResult(war, sel, snapshotBattleResult(sim));
    expect(hero.mp).toBe(sim.generals[1].mp);
  });
});
