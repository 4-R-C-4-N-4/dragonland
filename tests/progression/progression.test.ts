import { describe, expect, it } from 'vitest';
import type { UnitDef, GeneralDef } from '../../src/data/schemas';
import { awardTroopXp, awardHeroXp, pendingMilestones, chooseHeroUpgrade, deriveTroopStats, deriveHeroDef, getProgressionConfig, ProgressionConfigSchema, type ProgressTroop, type HeroProgress } from '../../src/progression';

const unit = (id: string, stage: 1|2|3, evolvesTo?: string): UnitDef => ({ id, name: id, stage, evolvesTo, classId: 'beast', line: 'Z', moveSpeed: 50, attackRange: 20, attackCooldownS: 1, flying: false, bodyRadius: 5 });
const chain = { dog: unit('dog', 1, 'wolf'), wolf: unit('wolf', 2, 'warg'), warg: unit('warg', 3) };
const troop: ProgressTroop = { id: 'a', name: 'Veteran', unitId: 'dog', xp: 0, level: 1 };
const hero: HeroProgress = { generalId: 'paladin', xp: 0, level: 1, upgrades: { vitality: 0, might: 0, mastery: 0 }, claimedMilestones: [] };
const base: GeneralDef = { id: 'paladin', unitId: 'paladin', name: 'Paladin', hp: 1500, attack: 3, mp: 100, level: 10, special: { id: 'rally', name: 'Rally', mpCost: 40, cooldownS: 20, kind: 'radiusHeal', radius: 160, amount: 40 } };

describe('pure progression', () => {
  it('validates JSON defaults and returns isolated config', () => {
    const c = getProgressionConfig();
    expect(c.troop.xpPerVictory).toBe(100); expect(c.troop.xpPerBossVictory).toBe(150);
    expect(c.hero.xpPerVictory).toBe(100);
    expect(ProgressionConfigSchema.safeParse({ ...c, troop: { ...c.troop, xpPerLevel: 0 } }).success).toBe(false);
    c.hero.milestones.pop(); expect(getProgressionConfig().hero.milestones).toEqual([3,5,7,9,11]);
  });
  it('awards individual cumulative XP, evolves at 3 and 6, and caps levels', () => {
    const two = awardTroopXp(troop, 100, chain);
    expect(two).toEqual({ ...troop, xp: 100, level: 2 });
    const three = awardTroopXp(two, 100, chain);
    expect(three).toEqual({ ...troop, unitId: 'wolf', xp: 200, level: 3 });
    expect(awardTroopXp(three, 299, chain).unitId).toBe('wolf');
    expect(awardTroopXp(three, 300, chain).unitId).toBe('warg');
    expect(awardTroopXp(troop, 10000, chain)).toEqual({ ...troop, xp: 10000, level: 12, unitId: 'warg' });
    expect(troop.xp).toBe(0);
  });
  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid XP %s', amount => {
    expect(() => awardTroopXp(troop, amount, chain)).toThrow();
    expect(() => awardHeroXp(hero, amount)).toThrow();
    expect(() => awardTroopXp({ ...troop, xp: amount }, 0, chain)).toThrow();
    expect(() => awardHeroXp({ ...hero, xp: amount }, 0)).toThrow();
  });
  it.each([0, 13, 1.5, NaN])('rejects illegal level %s', level => {
    expect(() => deriveTroopStats(chain.dog, level)).toThrow();
    expect(() => awardTroopXp({ ...troop, level }, 0, chain)).toThrow();
    expect(() => awardHeroXp({ ...hero, level }, 0)).toThrow();
    expect(() => deriveHeroDef(base, { ...hero, level })).toThrow();
  });
  it('rejects missing eligible links, bad stages, identities and cycles', () => {
    for (const units of [ { dog: unit('dog', 1) }, { dog: chain.dog }, { ...chain, wolf: unit('wolf', 3) }, { ...chain, wolf: unit('dog', 2) }, { ...chain, warg: unit('warg', 3, 'dog') } ]) {
      expect(() => awardTroopXp(troop, 1000, units)).toThrow();
    }
    expect(() => awardTroopXp({ ...troop, unitId: 'missing' }, 0, chain)).toThrow();
  });
  it('derives HP and damage exactly once while preserving species movement', () => {
    for (const [u, mult] of [[chain.dog,1], [chain.wolf,1.3], [chain.warg,1.6]] as const) {
      const stats = deriveTroopStats(u, 6);
      expect(stats.hp).toBeCloseTo(100 * mult * 1.1);
      expect(stats.damageMultiplier).toBeCloseTo(mult * 1.1);
      expect(stats.moveSpeed).toBe(u.moveSpeed); expect(stats.attackRange).toBe(u.attackRange); expect(stats.attackCooldownS).toBe(u.attackCooldownS);
      expect(deriveTroopStats(u, 1, 200).hp).toBeCloseTo(200 * mult);
    }
  });
  it('queues every earned milestone, claims once and compounds repeated ranks', () => {
    const grown = awardHeroXp(hero, 10000);
    expect(grown.level).toBe(12); expect(grown.xp).toBe(10000);
    expect(pendingMilestones(grown)).toEqual([3,5,7,9,11]);
    const first = chooseHeroUpgrade(grown, 'vitality');
    const second = chooseHeroUpgrade(first, 'vitality');
    expect(second.claimedMilestones).toEqual([3,5]);
    const third = chooseHeroUpgrade(second, 'might');
    const fourth = chooseHeroUpgrade(third, 'mastery');
    const all = chooseHeroUpgrade(fourth, 'mastery');
    expect(pendingMilestones(all)).toEqual([]); expect(() => chooseHeroUpgrade(all, 'might')).toThrow();
    const result = deriveHeroDef(base, all);
    expect(result.hp).toBeCloseTo(1500 * 1.33 * 1.1 ** 2);
    expect(result.attack).toBeCloseTo(3 * 1.33 * 1.1);
    expect(result.special.amount).toBeCloseTo(40 * 1.1 ** 2);
    expect(result.mp).toBe(100); expect(result.special.cooldownS).toBe(20); expect(result.level).toBe(12);
    expect(hero.xp).toBe(0); expect(grown.upgrades.vitality).toBe(0); expect(grown.claimedMilestones).toEqual([]);
    result.special.amount = 0; expect(base.special.amount).toBe(40);
  });
  it('uses level-1 general baselines and exact hero thresholds', () => {
    expect(deriveHeroDef(base, hero)).toEqual({ ...base, level: 1 });
    expect(awardHeroXp(hero, 149).level).toBe(1); expect(awardHeroXp(hero, 150).level).toBe(2);
    expect(pendingMilestones(awardHeroXp(hero, 300))).toEqual([3]);
    expect(() => chooseHeroUpgrade(hero, 'vitality')).toThrow();
    expect(() => chooseHeroUpgrade(awardHeroXp(hero, 300), 'invalid' as 'might')).toThrow();
  });
  it('rejects invalid, duplicate or unearned claimed milestones', () => {
    for (const claimedMilestones of [[3,3], [4], [11]]) expect(() => pendingMilestones({ ...hero, claimedMilestones })).toThrow();
    expect(() => deriveHeroDef(base, { ...hero, generalId: 'dragon' })).toThrow();
  });
});
