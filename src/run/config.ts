import { z } from 'zod';
import raw from '../../data/run.json';
import { ClassIdSchema } from '../data/schemas';

export const RunConfigSchema = z.object({
  battles: z.number().int().min(1),
  startingTroopsPerLine: z.number().int().min(2),
  startingClasses: z.array(ClassIdSchema).length(5).refine((xs) => new Set(xs).size === 5, 'classes must be unique'),
  encounterOfferCount: z.number().int().min(1).max(4),
  recruitOfferCount: z.number().int().min(1).max(6),
  recruitsPerOffer: z.number().int().positive(),
  rosterCap: z.number().int().min(100),
  /** Share of the fallen who were only wounded and rejoin after a VICTORY (none after a defeat). */
  woundedRecoveryOnWin: z.number().min(0).max(1),
  enemyStartingTroops: z.number().int().min(2),
  enemyTroopsPerDepth: z.number().int().nonnegative(),
  enemyMaxTroops: z.number().int().min(2).max(100),
  enemyStage2Depth: z.number().int().positive(),
  enemyStage3Depth: z.number().int().positive(),
  enemyStage2Share: z.number().min(0).max(1),
  enemyStage3Share: z.number().min(0).max(1),
  enemyGeneralGrowthPerDepth: z.number().nonnegative(),
  bossGeneralMultiplier: z.number().positive(),
  defaultTeamColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).refine((cfg) => cfg.startingTroopsPerLine * 3 <= Math.min(cfg.rosterCap, 100), 'starting company must fit')
  .refine((cfg) => cfg.enemyStartingTroops <= cfg.enemyMaxTroops, 'enemy start exceeds cap')
  .refine((cfg) => cfg.enemyStage3Depth >= cfg.enemyStage2Depth, 'stage 3 cannot precede stage 2')
  .refine((cfg) => cfg.enemyStage2Share + cfg.enemyStage3Share <= 1, 'enemy stage shares exceed one');
export type RunConfig = z.infer<typeof RunConfigSchema>;
export function getRunConfig(): RunConfig { return RunConfigSchema.parse(raw); }
