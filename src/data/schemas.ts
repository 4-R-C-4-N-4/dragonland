// Zod schemas for /data/*.json. These are the content contract (implementation.md §4).
// Types used across sim/render/ui/ai are inferred from here so there is one source of truth.
import { z } from 'zod';

export const ClassIdSchema = z.enum(['beast', 'mage', 'ethereal', 'construct', 'human']);
export const LineSchema = z.enum(['A', 'M', 'Z']);
export const DispositionSchema = z.enum(['fierce', 'mixed', 'guard']);
export const CommandSchema = z.enum(['advance', 'hold', 'fallBack']);
export const GeneralIdSchema = z.enum(['paladin', 'dragon']);

export type ClassId = z.infer<typeof ClassIdSchema>;
export type Line = z.infer<typeof LineSchema>;
export type Disposition = z.infer<typeof DispositionSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type GeneralId = z.infer<typeof GeneralIdSchema>;

export const ConstantsSchema = z.object({
  TROOP_HP: z.number().positive(),
  BASE_DAMAGE: z.number().positive(),
  CLASS_MOD: z.number(),
  LINE_DEAL_MOD: z.number(),
  LINE_TAKE_MOD: z.number(),
  MIN_DAMAGE_MULT: z.number().positive(),
  SKIRMISH_TIME_S: z.number().positive(),
  SPECIAL_CHARGE_PER_S: z.number().nonnegative(),
  SPECIAL_CHARGE_PER_HIT: z.number().nonnegative(),
  SPECIAL_METER_MAX: z.number().positive(),
  STAGE2_STAT_MULT: z.number().positive(),
  MAX_COMPANY: z.number().int().positive(),
  MAX_SQUADS: z.number().int().positive(),
  MIN_SQUAD: z.number().int().positive(),
  SIM_HZ: z.number().int().positive(),
  FIELD_W: z.number().positive(),
  FIELD_H: z.number().positive(),
  GRID_CELL: z.number().positive(),
  RETARGET_INTERVAL_S: z.number().positive(),
  KITE_RANGE_FRAC: z.number().nonnegative(),
  RANGED_THRESHOLD: z.number().positive(),
  GENERAL_START_INSET: z.number().nonnegative(),
  GENERAL_LEASH: z.number().nonnegative(),
  FORMATION_DEPTH: z.number().positive(),
  FORMATION_HALF_WIDTH: z.number().positive(),
  TROOP_SPACING: z.number().positive(),
  JITTER_FRAC: z.number().nonnegative(),
  DUEL_ENTRY_CHIP_PER_SURVIVOR: z.number().nonnegative(),
  DEPLOY_COUNTDOWN_S: z.number().nonnegative(),
  DUEL_CADENCE_S: z.number().positive(),
  DUEL_MAX_ROUNDS: z.number().int().positive(),
  ROSTER_SIZE: z.number().int().positive(),
});
export type Constants = z.infer<typeof ConstantsSchema>;

export const ClassDefSchema = z.object({
  id: ClassIdSchema,
  name: z.string(),
  strongAgainst: ClassIdSchema,
  color: z.string(),
});
export type ClassDef = z.infer<typeof ClassDefSchema>;

export const UnitDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  classId: ClassIdSchema,
  line: LineSchema,
  stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  evolvesTo: z.string().optional(),
  moveSpeed: z.number().positive(),
  attackRange: z.number().positive(),
  attackCooldownS: z.number().positive(),
  flying: z.boolean(),
  bodyRadius: z.number().positive(),
});
export type UnitDef = z.infer<typeof UnitDefSchema>;

export const SpecialDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  mpCost: z.number().nonnegative(),
  /** MP spent on a special is restored in full once this cooldown elapses (DECISIONS D2). */
  cooldownS: z.number().nonnegative(),
  kind: z.enum(['cone', 'radiusHeal', 'radiusDamage']),
  radius: z.number().positive(),
  amount: z.number().nonnegative(),
  coneHalfAngleDeg: z.number().positive().optional(),
});
export type SpecialDef = z.infer<typeof SpecialDefSchema>;

export const GeneralDefSchema = z.object({
  id: GeneralIdSchema,
  unitId: z.string(),
  name: z.string(),
  hp: z.number().positive(),
  mp: z.number().nonnegative(),
  level: z.number().int().positive(),
  attack: z.number().positive(),
  special: SpecialDefSchema,
});
export type GeneralDef = z.infer<typeof GeneralDefSchema>;

export const FormationDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Offsets are normalized: fx * FORMATION_DEPTH toward the enemy, fy * FORMATION_HALF_WIDTH laterally. */
  generalOffset: z.object({ fx: z.number(), fy: z.number() }),
  slots: z.array(z.object({ fx: z.number(), fy: z.number() })).min(1),
});
export type FormationDef = z.infer<typeof FormationDefSchema>;
export type FormationId = string;

export const AiLoadoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  generalId: GeneralIdSchema,
  formation: z.string(),
  /** Test-only loadouts (e.g. mirror pair) are excluded from enemy commit selection. */
  test: z.boolean().optional(),
  squads: z
    .array(
      z.object({
        name: z.string(),
        disposition: DispositionSchema,
        units: z.array(z.object({ unitId: z.string(), count: z.number().int().positive() })).min(1),
      }),
    )
    .min(1),
});
export type AiLoadout = z.infer<typeof AiLoadoutSchema>;

export const DispositionBehaviorSchema = z.object({
  fierce: z.object({
    holdPursuitDist: z.number().nonnegative(),
    fallBackEngageDist: z.number().nonnegative(),
  }),
  mixed: z.object({
    cohesionRadius: z.number().positive(),
    /** Fraction of move speed used to pull each member back to its formation slot. */
    formationPull: z.number().nonnegative(),
  }),
  guard: z.object({
    leashRadius: z.number().positive(),
    ringRadius: z.number().positive(),
  }),
  separationWeight: z.number().nonnegative(),
  separationRadius: z.number().positive(),
  generalLeashSpeedFrac: z.number().positive(),
  /** Hard body-overlap resolution passes per tick. */
  overlapIterations: z.number().int().nonnegative(),
});
export type DispositionBehavior = z.infer<typeof DispositionBehaviorSchema>;

export const AiPolicySchema = z.object({
  generalLowHpFrac: z.number().positive(),
  threatClearRadius: z.number().positive(),
  specialMinEnemiesInArea: z.number().int().nonnegative(),
  specialMinWoundedAllies: z.number().int().nonnegative(),
  decisionIntervalS: z.number().positive(),
});
export type AiPolicy = z.infer<typeof AiPolicySchema>;

export const NamesSchema = z.object({
  first: z.array(z.string()).min(1),
  middle: z.array(z.string()).min(1),
  last: z.array(z.string()).min(1),
});
export type Names = z.infer<typeof NamesSchema>;

// ---- Persisted / runtime records (§4) ----

export const TroopSchema = z.object({
  id: z.string(),
  name: z.string(),
  unitId: z.string(),
});
export type Troop = z.infer<typeof TroopSchema>;

export const SquadSchema = z.object({
  id: z.string(),
  name: z.string(),
  troopIds: z.array(z.string()),
  disposition: DispositionSchema,
});
export type Squad = z.infer<typeof SquadSchema>;

export const LoadoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  generalId: GeneralIdSchema,
  squads: z.array(SquadSchema),
});
export type Loadout = z.infer<typeof LoadoutSchema>;
