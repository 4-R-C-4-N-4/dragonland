// Persisted run state (MVP2). One versioned snapshot, validated with zod on load.
import { z } from 'zod';
import { ClassIdSchema, DispositionSchema, GeneralDefSchema, GeneralIdSchema } from '../data/schemas';

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ProgressTroopSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  unitId: z.string().min(1),
  xp: z.number().finite().nonnegative(),
  level: z.number().int().min(1),
});

export const HeroProgressSchema = z.object({
  generalId: GeneralIdSchema,
  xp: z.number().finite().nonnegative(),
  level: z.number().int().min(1),
  upgrades: z.object({ vitality: z.number().int().nonnegative(), might: z.number().int().nonnegative(), mastery: z.number().int().nonnegative() }),
  claimedMilestones: z.array(z.number().int()),
});

// Battle setups are sim inputs; validated loosely here and re-validated by createBattle.
// Frozen general definitions use the content schema itself, so specials can't drift.
const GeneralSchema = GeneralDefSchema;
const TroopSetupSchema = z.object({ troopId: z.string(), name: z.string(), unitId: z.string(), statMult: z.number().positive().optional() });
const SquadSetupSchema = z.object({ id: z.string(), name: z.string(), disposition: DispositionSchema, troops: z.array(TroopSetupSchema), color: Hex.optional() });
export const SideSetupSchema = z.object({
  generalId: GeneralIdSchema, formationId: z.string(), squads: z.array(SquadSetupSchema),
  general: GeneralSchema.optional(), color: Hex.optional(),
});

export const EncounterSchema = z.object({
  id: z.string(),
  depth: z.number().int().nonnegative(),
  boss: z.boolean(),
  name: z.string(),
  /** Enemy disposition doctrine (D23); optional for saves made before it existed. */
  doctrine: z.enum(['balanced', 'assault', 'defensive', 'skirmish']).optional(),
  side: SideSetupSchema,
});

export const RecruitOfferSchema = z.object({
  id: z.string(),
  troops: z.array(ProgressTroopSchema),
});

export const BattleSummarySchema = z.object({
  battleId: z.string(),
  won: z.boolean(),
  /** Optional for older v2 summaries. A forfeiture does not imply general death. */
  forfeited: z.boolean().optional(),
  boss: z.boolean(),
  /** Actual deployed survivors, excluding recovered wounded and benched troops. Absent in older v2 summaries. */
  survived: z.array(z.object({ id: z.string(), name: z.string(), unitId: z.string() })).optional(),
  /** Roster troops not deployed in this battle. Absent in older v2 summaries. */
  benched: z.number().int().nonnegative().optional(),
  dead: z.array(z.object({ id: z.string(), name: z.string(), unitId: z.string() })),
  /** Fallen who were only wounded and rejoined after the victory. */
  recovered: z.array(z.object({ id: z.string(), name: z.string(), unitId: z.string() })).default([]),
  xpAwarded: z.number(),
  levelUps: z.number().int().nonnegative(),
  evolutions: z.array(z.object({ troopId: z.string(), name: z.string(), from: z.string(), to: z.string() })),
  heroLevelFrom: z.number().int(),
  heroLevelTo: z.number().int(),
  /** Class newly unlocked by defeating this battle's enemy general (victory only). */
  unlockedClass: ClassIdSchema.optional(),
});

export const RunPhaseSchema = z.enum(['select', 'prepare', 'battle', 'rewards', 'won', 'lost']);

export const RunStateSchema = z.object({
  version: z.literal(2),
  id: z.string(),
  seed: z.number().int().nonnegative(),
  phase: RunPhaseSchema,
  /** Victories so far. */
  depth: z.number().int().nonnegative(),
  /** Classes available for starting troops/recruiting; grows by defeating enemy generals of locked classes. */
  unlockedClasses: z.array(ClassIdSchema).min(1),
  color: Hex,
  hero: HeroProgressSchema,
  /** Earned, unclaimed hero milestone levels (mirrors progression.pendingMilestones). */
  pendingMilestones: z.array(z.number().int()),
  roster: z.array(ProgressTroopSchema),
  offers: z.array(EncounterSchema),
  encounter: EncounterSchema.nullable(),
  battle: z.object({ id: z.string(), setup: z.object({ seed: z.number().int().nonnegative(), sides: z.tuple([SideSetupSchema, SideSetupSchema]) }) }).nullable(),
  recruitOffers: z.array(RecruitOfferSchema),
  lastSummary: BattleSummarySchema.nullable(),
  processedBattleIds: z.array(z.string()),
  battleCounter: z.number().int().nonnegative(),
});

export type RunState = z.infer<typeof RunStateSchema>;
export type RunPhase = z.infer<typeof RunPhaseSchema>;
export type Encounter = z.infer<typeof EncounterSchema>;
export type RecruitOffer = z.infer<typeof RecruitOfferSchema>;
export type BattleSummary = z.infer<typeof BattleSummarySchema>;
