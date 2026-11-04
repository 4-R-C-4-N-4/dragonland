// Zod schemas for /data/*.json. These are the content contract (implementation.md §4).
// Types used across sim/render/ui/ai are inferred from here so there is one source of truth.
import { z } from 'zod';

export const ClassIdSchema = z.enum(['beast', 'mage', 'ethereal', 'construct', 'human']);
export const LineSchema = z.enum(['A', 'M', 'Z']);
export const DispositionSchema = z.enum(['fierce', 'mixed', 'guard']);
export const CommandSchema = z.enum(['advance', 'hold', 'fallBack']);
export const ApproachSchema = z.enum(['direct', 'farFlank', 'nearFlank']);
/** Every stage-3 species can lead as a general (MVP2, D24). Ids equal their unit ids. */
export const GeneralIdSchema = z.enum([
  'paladin', 'deadeye', 'assassin', 'dragon', 'eagle', 'warg', 'archmage', 'diabolist', 'hierophant',
  'devil', 'shepherd', 'archangel', 'servitor', 'kyilkhor', 'anima',
]);

export type ClassId = z.infer<typeof ClassIdSchema>;
export type Line = z.infer<typeof LineSchema>;
export type Disposition = z.infer<typeof DispositionSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type Approach = z.infer<typeof ApproachSchema>;
export type GeneralId = z.infer<typeof GeneralIdSchema>;

export const ConstantsSchema = z.object({
  TROOP_HP: z.number().positive(),
  BASE_DAMAGE: z.number().positive(),
  CLASS_MOD: z.number(),
  LINE_DEAL_MOD: z.number(),
  LINE_TAKE_MOD: z.number(),
  MIN_DAMAGE_MULT: z.number().positive(),
  SKIRMISH_TIME_S: z.number().positive(),
  STAGE2_STAT_MULT: z.number().positive(),
  /** Stage-3 species fielded as ordinary troops (MVP2). Generals use their own GeneralDef. */
  STAGE3_STAT_MULT: z.number().positive(),
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
  /** Demo/testing: 1 = the builder recruits fresh named troops whenever a composition needs more than the roster has. 0 = scarce roster. */
  ROSTER_AUTO_RECRUIT: z.number().int().min(0).max(1),
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

const SpecialDamageEffectSchema = z.object({
  type: z.literal('damage'),
  /** field: every enemy troop; wave: band along caster -> enemy general across the whole field;
   *  random: `targets` distinct enemy troops; general: the enemy general only. */
  area: z.enum(['field', 'wave', 'random', 'general']),
  /** Damage before class/line modifiers (same scale as BASE_DAMAGE). */
  amount: z.number().positive(),
  includeGeneral: z.boolean().default(false),
  targets: z.number().int().positive().optional(),
  /** Wave half-width (sim units). */
  width: z.number().positive().optional(),
});
const SpecialHealEffectSchema = z.object({ type: z.literal('heal'), /** of max HP, own troops + general */ fraction: z.number().positive().max(1) });
const SpecialBuffEffectSchema = z.object({
  type: z.literal('buff'),
  durationS: z.number().positive(),
  damageMult: z.number().positive().default(1),
  speedMult: z.number().positive().default(1),
  /** < 1 = takes less damage */
  defenseMult: z.number().positive().default(1),
});
const SpecialDebuffEffectSchema = z.object({
  type: z.literal('debuff'),
  durationS: z.number().positive(),
  damageMult: z.number().positive().default(1),
  speedMult: z.number().positive().default(1),
  /** damage per second to every enemy troop while active */
  dotPerS: z.number().nonnegative().default(0),
});
export const SpecialEffectSchema = z.discriminatedUnion('type', [SpecialDamageEffectSchema, SpecialHealEffectSchema, SpecialBuffEffectSchema, SpecialDebuffEffectSchema]);
export type SpecialEffect = z.infer<typeof SpecialEffectSchema>;
export type SpecialEffectInput = z.input<typeof SpecialEffectSchema>;

/** Dragon Force-style specials: field-wide, not local (D24). */
const CurrentSpecialDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** Effect art id: assets/fx/<fx>.{png,json}. */
  fx: z.string().regex(/^[a-z-]+$/),
  /** Seconds to recharge from empty to full MP during combat. */
  rechargeS: z.number().finite().positive(),
  /** Scales damage, heal and buff/debuff strength (general mastery upgrades). */
  power: z.number().positive().default(1),
  effects: z.array(SpecialEffectSchema).min(1),
});
// Legacy content and frozen v2 campaign snapshots share this normalization.
// An explicitly supplied rechargeS must validate on its own, even if cooldownS exists.
export const SpecialDefSchema = z.preprocess((input) => {
  if (input && typeof input === 'object' && !Array.isArray(input) && !Object.hasOwn(input, 'rechargeS')) {
    const legacy = input as Record<string, unknown>;
    return { ...legacy, rechargeS: legacy.cooldownS };
  }
  return input;
}, CurrentSpecialDefSchema);
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
  /** Preferred team colour; replaced at commit time if it clashes with the player's colours. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
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
  /** Fierce: goes for the enemy general (MVP2), fighting through troops that block its path. */
  fierce: z.object({
    holdPursuitDist: z.number().nonnegative(),
    fallBackEngageDist: z.number().nonnegative(),
    /** true = Advance targets the enemy general; false = nearest enemy anywhere (MVP1 behaviour). */
    generalFocus: z.boolean(),
    /** While going for the general, engage enemy troops within this distance of the troop (at least its attack range). */
    blockRadius: z.number().nonnegative(),
    /** Charge: move-speed multiplier for Fierce troops. */
    speedMult: z.number().positive(),
    /** Damage multiplier for Fierce troops hitting a general. */
    generalDamageMult: z.number().positive(),
    /** >0: while farther than this (x) from the enemy general, Fierce routes along a field edge (flank). 0 = straight line. */
    flankDist: z.number().nonnegative(),
  }),
  /** Mixed: fights enemy troops as a loose group. */
  mixed: z.object({
    /** Per-troop search distance on Advance; 0 = whole field. */
    engageRadius: z.number().nonnegative(),
    holdEngageDist: z.number().nonnegative(),
    fallBackEngageDist: z.number().nonnegative(),
    /** Fraction of move speed used to pull each member back to its formation slot. */
    formationPull: z.number().nonnegative(),
    /** true = the whole squad moves at its slowest member's speed (MVP1 behaviour). */
    slowestSpeed: z.boolean(),
    /** false = never targets the enemy general while enemy troops remain. */
    targetGenerals: z.boolean(),
  }),
  /** Guard: protects its own general; commands still apply. */
  guard: z.object({
    /** Enemies within this distance of the general's CURRENT position are threats and take priority. */
    threatRadius: z.number().positive(),
    /** With nothing to fight, guards return to within this distance of the general. */
    ringRadius: z.number().positive(),
    /** true = on Advance, guards with no threat fight enemy troops like Mixed; false = escort only. */
    advanceFights: z.boolean(),
  }),
  approach: z.object({
    laneFraction: z.number().positive().lt(0.5),
    arrivalRadius: z.number().positive(),
    turnDistance: z.number().positive(),
  }),
  /** Unprovoked enemies are acquired within attackRange + this distance of the home position. */
  generalEngageRadius: z.number().nonnegative(),
  /** Seconds to remember an attacker after it stops targeting the general. */
  generalAggroMemoryS: z.number().positive(),
  separationWeight: z.number().nonnegative(),
  separationRadius: z.number().positive(),
  /** Return-home speed only; pursuit must close on unmodified kiting attackers. */
  generalLeashSpeedFrac: z.number().positive(),
  generalPursuitSpeedMult: z.number().gt(1),
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

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const SquadSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Resolved named troops. Derived from `composition` + `pinned` by the builder; what the battle uses. */
  troopIds: z.array(z.string()),
  disposition: DispositionSchema,
  /** Desired unit counts (unitId -> count). The builder fills troopIds from the roster to match. */
  composition: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** Troop ids the player chose by hand; never swapped out by auto-fill. */
  pinned: z.array(z.string()).optional(),
  /** Squad colour; when absent a shade of the team colour is derived. */
  color: HexColorSchema.optional(),
});
export type Squad = z.infer<typeof SquadSchema>;

export const LoadoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  generalId: GeneralIdSchema,
  squads: z.array(SquadSchema),
  /** Team colour. */
  color: HexColorSchema.optional(),
});
export type Loadout = z.infer<typeof LoadoutSchema>;

export const BiomeSchema = z.enum(['plains', 'forest', 'mountain', 'swamp', 'ruins', 'settled']);
export const WorldNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['castle', 'town', 'village', 'lair']),
  biome: BiomeSchema,
  name: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  owner: z.string().min(1).nullable(),
  supplyPerWeek: z.number().int().nonnegative(),
  incomePerTurn: z.number().int().nonnegative(),
  garrisonCap: z.number().int().nonnegative(),
});
export const WorldRouteSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
}).refine((r) => r.from !== r.to, 'route endpoints must differ');
export const WorldFactionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isPlayer: z.boolean(),
  personality: z.enum(['aggressive', 'defensive', 'opportunist']),
  classes: z.array(ClassIdSchema).min(1),
});
/** Wild species a Search order can find, per biome, with relative weights.
 * Tables may be omitted in standalone schema fixtures; buildWorldData validates wild tables.
 */
export const BiomeTableSchema = z.partialRecord(BiomeSchema, z.array(z.object({
  unitId: z.string().min(1),
  weight: z.number().positive(),
  count: z.number().int().positive(),
})));
export const WorldDataSchema = z.object({
  nodes: z.array(WorldNodeSchema),
  routes: z.array(WorldRouteSchema),
  factions: z.array(WorldFactionSchema),
  biomes: BiomeTableSchema,
});
export type WorldData = z.infer<typeof WorldDataSchema>;

export const WorldConstantsSchema = z.object({
  TURNS_PER_WEEK: z.number().int().positive(),
  HEAL_HP_PER_REST_FRAC: z.number().min(0).max(1),
  RESUPPLY_TROOPS_PER_REST: z.number().int().nonnegative(),
  CAPTURE_WEIGHT: z.number().min(0).max(1),
  INJURE_WEIGHT: z.number().min(0).max(1),
  KILL_WEIGHT: z.number().min(0).max(1),
  GARRISON_CAP: z.number().int().positive(),
  MAX_DIVISION_GENERALS: z.number().int().positive(),
  SEARCH_CHANCE_LAIR: z.number().min(0).max(1),
  SEARCH_CHANCE_WILD: z.number().min(0).max(1),
  INJURY_TURNS: z.number().int().nonnegative(),
  STARTING_GOLD: z.number().int().nonnegative(),
  STARTING_TROOPS: z.number().int().nonnegative(),
  STARTING_GENERALS: z.number().int().positive(),
  STARTING_CAPACITY: z.number().int().positive(),
}).refine(c => Math.abs(c.CAPTURE_WEIGHT + c.INJURE_WEIGHT + c.KILL_WEIGHT - 1) <= 1e-9,
  'CAPTURE_WEIGHT, INJURE_WEIGHT and KILL_WEIGHT must sum to 1')
  .refine(c => c.GARRISON_CAP > c.MAX_DIVISION_GENERALS,
    'GARRISON_CAP must exceed MAX_DIVISION_GENERALS')
  .refine(c => c.STARTING_GENERALS * c.STARTING_CAPACITY >= c.STARTING_TROOPS,
    'STARTING_GENERALS * STARTING_CAPACITY must cover STARTING_TROOPS');
export type WorldConstants = z.infer<typeof WorldConstantsSchema>;
