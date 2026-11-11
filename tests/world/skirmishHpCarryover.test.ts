import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle } from '../../src/sim';
import { buildWorldData, createWar, rawWorldData, wildBattleSetup, wildEncounter } from '../../src/world';
import { applySkirmishResult, commitAttacker, commitDefender, sequenceEncounter } from '../../src/world/sequence';

const data = buildWorldData(rawWorldData);
const game = getGameData();

describe('HP carried between campaign skirmishes', () => {
  for (const winner of [0, 1] as const) {
    it(`keeps side ${winner}'s damage and true maximum HP in the next skirmish`, () => {
      const war = createWar(data, { seed: 17, heroId: 'eagle', heroName: 'Ivy' });
      const own = war.divisions.find(d => d.factionId === 'player')!;
      const enemy = war.divisions.find(d => d.factionId !== 'player')!;
      // Two non-hero opponents let either side win without ending the encounter.
      own.generals = own.generals.filter(id => !war.generals.find(g => g.id === id)!.isHero);
      enemy.generals = war.generals.filter(g => g.factionId === enemy.factionId).slice(0, 2).map(g => g.id);
      war.pendingBattle = { id: 'hp-carry', cause: 'contact', nodeId: own.atNode, attacker: own.id, defender: enemy.id, wild: [], processedSkirmishIds: [] };
      war.phase = 'battle';
      const seq = sequenceEncounter(war, war.pendingBattle);
      commitDefender(war, seq, seq.defenderGeneralIds[0]!);
      const first = commitAttacker(war, seq, seq.attackerGeneralIds[0]!);
      const survivor = war.generals.find(g => g.id === first.generalIds[winner])!;
      const maxHp = survivor.maxHp;
      const ids = first.setup.sides.map(s => s.squads.flatMap(q => q.troops.map(t => t.troopId)));
      // Controlled terminal result isolates carry-over from combat randomness.
      applySkirmishResult(war, seq, first.id, {
        result: { winner, reason: 'generalDefeated', durationS: 1, hadDuel: false,
          dead: winner === 0 ? [[], ids[1]!] : [ids[0]!, []],
          survivors: winner === 0 ? [ids[0]!, []] : [[], ids[1]!] },
        generalHp: winner === 0 ? [600, 0] : [0, 600],
      });
      expect(survivor.hp).toBe(600);
      expect(war.pendingBattle).not.toBeNull();
      const defender = seq.defenderGeneralIds.find(id => !seq.defeatedGeneralIds.includes(id))!;
      const attacker = seq.attackerGeneralIds.find(id => !seq.defeatedGeneralIds.includes(id))!;
      commitDefender(war, seq, defender);
      const second = commitAttacker(war, seq, attacker);
      expect(second.generalIds[winner]).toBe(survivor.id);
      const battle = createBattle(game, second.setup);
      const entity = battle.generals[winner].entity;
      expect(battle.ents.hp[entity]).toBe(600);
      expect(battle.ents.maxHp[entity]).toBe(maxHp);
      // The next result must validate against current HP, not the maximum.
      const nextIds = second.setup.sides.map(s => s.squads.flatMap(q => q.troops.map(t => t.troopId)));
      expect(() => applySkirmishResult(war, seq, second.id, {
        result: { winner, reason: 'generalDefeated', durationS: 1, hadDuel: false,
          dead: winner === 0 ? [[], nextIds[1]!] : [nextIds[0]!, []],
          survivors: winner === 0 ? [nextIds[0]!, []] : [[], nextIds[1]!] },
        generalHp: winner === 0 ? [500, 0] : [0, 500],
      })).not.toThrow();
      expect(survivor.hp).toBe(500);
    });
  }

  it('keeps a wounded searching general’s current and maximum HP distinct', () => {
    const war = createWar(data, { seed: 17, heroId: 'eagle', heroName: 'Ivy' });
    const division = war.divisions.find(d => d.factionId === 'player')!;
    const hero = war.generals.find(g => g.isHero)!;
    hero.hp = 450;
    war.pendingBattle = wildEncounter(war, division.id, [{ unitId: 'dog', count: 8 }]);
    const selection = wildBattleSetup(war, division.id, hero.id);
    const battle = createBattle(game, selection.setup);
    expect(battle.ents.hp[battle.generals[1].entity]).toBe(450);
    expect(battle.ents.maxHp[battle.generals[1].entity]).toBe(hero.maxHp);
  });
});
