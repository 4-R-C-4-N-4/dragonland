import { z } from 'zod';
import defaults from '../../data/progression.json';
import type { UnitDef, GeneralDef } from '../data/schemas';

const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
const level = z.number().int().min(1).max(12);
export const ProgressionConfigSchema = z.object({
  troop: z.object({
    xpPerVictory: nonnegative, xpPerBossVictory: nonnegative,
    xpPerLevel: positive, maxLevel: z.number().int().min(6).max(12),
    evolutionLevels: z.tuple([level, level]).refine(([a,b]) => a < b),
    stageMultipliers: z.tuple([positive, positive, positive]), growthPerLevel: nonnegative,
  }).refine(c => c.evolutionLevels[1] <= c.maxLevel),
  hero: z.object({
    xpPerVictory: nonnegative, xpPerLevel: positive,
    maxLevel: z.number().int().min(1).max(12), growthPerLevel: nonnegative,
    milestones: z.array(level).refine(xs => xs.every((x,i) => i === 0 || x > xs[i-1]!)),
    upgradePerRank: nonnegative,
  }).refine(c => c.milestones.every(x => x <= c.maxLevel)),
});
export type ProgressionConfig = z.infer<typeof ProgressionConfigSchema>;
const config = ProgressionConfigSchema.parse(defaults);
/** Each call returns an independent validated configuration snapshot. */
export function getProgressionConfig(): ProgressionConfig { return structuredClone(config); }

export interface ProgressTroop { id: string; name: string; unitId: string; xp: number; level: number }
export type HeroUpgradeKind = 'vitality' | 'might' | 'mastery';
export interface HeroUpgrades { vitality: number; might: number; mastery: number }
export interface HeroProgress {
  generalId: GeneralDef['id']; xp: number; level: number;
  upgrades: HeroUpgrades; claimedMilestones: number[];
}
/** Species lookup, independent of the production data index. */
export type UnitById = Readonly<Record<string, UnitDef | undefined>>;
export interface TroopStats {
  hp: number; damageMultiplier: number;
  moveSpeed: number; attackRange: number; attackCooldownS: number;
}
function validXp(xp: number): void {
  if (!Number.isFinite(xp) || xp < 0) throw new Error('XP must be finite and nonnegative');
}
function validLevel(value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error('Illegal progression level');
}
function levelFor(xp: number, perLevel: number, max: number): number {
  return Math.min(max, 1 + Math.floor(xp / perLevel));
}
function validateProgress(xp: number, current: number, tuning: { xpPerLevel: number; maxLevel: number }): void {
  validXp(xp); validLevel(current, tuning.maxLevel);
  if (current !== levelFor(xp, tuning.xpPerLevel, tuning.maxLevel)) throw new Error('Level does not match total XP');
}
/** Validates every declared link, including future links, without requiring a future absent link. */
function evolutionChain(id: string, units: UnitById): UnitDef[] {
  const result: UnitDef[] = [];
  const seen = new Set<string>();
  let next: string | undefined = id;
  while (next !== undefined) {
    if (seen.has(next)) throw new Error(`Evolution cycle at ${next}`);
    seen.add(next);
    const unit: UnitDef | undefined = Object.hasOwn(units, next) ? units[next] : undefined;
    if (!unit || unit.id !== next) throw new Error(`Invalid evolution unit ${next}`);
    if (![1,2,3].includes(unit.stage)) throw new Error('Invalid evolution stage');
    const previous = result.at(-1);
    if (previous && (unit.stage !== previous.stage + 1 || unit.classId !== previous.classId || unit.line !== previous.line)) {
      throw new Error(`Invalid evolution link to ${next}`);
    }
    result.push(unit);
    if (unit.stage === 3 && unit.evolvesTo !== undefined) throw new Error('Stage 3 cannot evolve');
    next = unit.evolvesTo;
  }
  return result;
}
export function awardTroopXp(troop: ProgressTroop, amount: number, unitById: UnitById): ProgressTroop {
  validateProgress(troop.xp, troop.level, config.troop); validXp(amount);
  const xp = troop.xp + amount; validXp(xp);
  const level = levelFor(xp, config.troop.xpPerLevel, config.troop.maxLevel);
  const chain = evolutionChain(troop.unitId, unitById);
  let unit = chain[0]!;
  let index = 0;
  while (unit.stage < 3 && level >= config.troop.evolutionLevels[unit.stage - 1]!) {
    const next = chain[++index];
    if (!next) throw new Error(`Missing eligible evolution for ${unit.id}`);
    unit = next;
  }
  return { ...troop, xp, level, unitId: unit.id };
}
function validateHero(hero: HeroProgress): void {
  validateProgress(hero.xp, hero.level, config.hero);
  const seen = new Set<number>();
  for (const milestone of hero.claimedMilestones) {
    if (!config.hero.milestones.includes(milestone) || milestone > hero.level || seen.has(milestone)) {
      throw new Error('Invalid, duplicate or unearned milestone');
    }
    seen.add(milestone);
  }
  let ranks = 0;
  for (const kind of ['vitality', 'might', 'mastery'] as const) {
    const rank = hero.upgrades[kind];
    if (!Number.isInteger(rank) || rank < 0) throw new Error('Invalid upgrade rank');
    ranks += rank;
  }
  if (ranks !== seen.size) throw new Error('Upgrade ranks must match claimed milestones');
}
export function awardHeroXp(hero: HeroProgress, amount: number): HeroProgress {
  validateHero(hero); validXp(amount);
  const xp = hero.xp + amount; validXp(xp);
  return { ...hero, xp, level: levelFor(xp, config.hero.xpPerLevel, config.hero.maxLevel), upgrades: { ...hero.upgrades }, claimedMilestones: [...hero.claimedMilestones] };
}
/** Ascending queue; choosing an upgrade consumes its earliest milestone. */
export function pendingMilestones(hero: HeroProgress): number[] {
  validateHero(hero);
  return config.hero.milestones.filter(x => x <= hero.level && !hero.claimedMilestones.includes(x));
}
export function chooseHeroUpgrade(hero: HeroProgress, kind: HeroUpgradeKind): HeroProgress {
  if (!['vitality', 'might', 'mastery'].includes(kind)) throw new Error('Invalid upgrade kind');
  const milestone = pendingMilestones(hero)[0];
  if (milestone === undefined) throw new Error('No earned milestone available');
  return { ...hero, upgrades: { ...hero.upgrades, [kind]: hero.upgrades[kind] + 1 }, claimedMilestones: [...hero.claimedMilestones, milestone] };
}
export function deriveTroopStats(unit: UnitDef, level: number, baseHp = 100): TroopStats {
  validLevel(level, config.troop.maxLevel);
  if (!Number.isFinite(baseHp) || baseHp <= 0) throw new Error('Base HP must be finite and positive');
  const stage = config.troop.stageMultipliers[unit.stage - 1];
  if (stage === undefined) throw new Error('Invalid troop stage');
  const damageMultiplier = stage * (1 + config.troop.growthPerLevel * (level - 1));
  return { hp: baseHp * damageMultiplier, damageMultiplier, moveSpeed: unit.moveSpeed, attackRange: unit.attackRange, attackCooldownS: unit.attackCooldownS };
}
/** General JSON stats are level-1 baselines, regardless of base.level (sandbox metadata). */
export function deriveHeroDef(base: GeneralDef, hero: HeroProgress): GeneralDef {
  validateHero(hero);
  if (base.id !== hero.generalId) throw new Error('Hero/general identity mismatch');
  const growth = 1 + config.hero.growthPerLevel * (hero.level - 1);
  const rank = (kind: HeroUpgradeKind) => (1 + config.hero.upgradePerRank) ** hero.upgrades[kind];
  return { ...base, level: hero.level, hp: base.hp * growth * rank('vitality'), attack: base.attack * growth * rank('might'), special: { ...base.special, power: base.special.power * rank('mastery') } };
}
