// Public sim contract. Render, UI, AI and the headless runner depend ONLY on this file and the functions
// exported from src/sim/index.ts. Pure TS: no DOM, no Pixi, no Math.random, no Date.
import type { Approach, Command, Disposition, GeneralDef, GeneralId, SpecialDef } from '../data/schemas';

export type Side = 0 | 1; // 0 = player (left, faces +x), 1 = enemy (right, faces -x)  — DECISIONS D10

// ---------- Battle setup (input) ----------

export interface TroopSetup {
  troopId: string; // roster id (player) or generated id (enemy)
  name: string;
  unitId: string;
  /**
   * Optional individual HP/damage multiplier (run progression: stage x level). Replaces the
   * species stage default when present. Must be > 0.
   */
  statMult?: number;
}

export interface SquadSetup {
  id: string; // unique within the battle side
  name: string;
  disposition: Disposition;
  troops: TroopSetup[];
  /** Presentation only (sim ignores it): explicit squad colour '#rrggbb'. */
  color?: string;
}

export interface SideSetup {
  generalId: GeneralId;
  formationId: string;
  squads: SquadSetup[];
  /** Optional derived general definition (hero progression). Its id must equal generalId. */
  general?: GeneralDef;
  /** Presentation only (sim ignores it): team colour '#rrggbb'. */
  color?: string;
}

export interface BattleSetup {
  seed: number;
  sides: [SideSetup, SideSetup];
}

// ---------- Runtime state (read surface) ----------

export type Phase = 'deploy' | 'fight' | 'duel' | 'result';

export interface SquadState {
  index: number; // index into world.squads
  id: string;
  name: string;
  side: Side;
  slot: number; // 0..3 within its side (banner number - 1)
  readonly disposition: Disposition; // fixed at deployment
  command: Command;
  approach: Approach;
  /** Reached the chosen flank lane; reset when changing approach or resuming Advance. */
  flankReady: boolean;
  members: number[]; // entity indices (alive or dead)
  total: number;
  alive: number;
  centroidX: number;
  centroidY: number;
}

export interface GeneralState {
  side: Side;
  entity: number; // entity index of the general
  def: GeneralDef;
  special: SpecialDef;
  mp: number;
  maxMp: number;
  meter: number; // 0..SPECIAL_METER_MAX
  specialCooldown: number; // seconds remaining; MP restored when it reaches 0 (D2)
  startX: number;
  startY: number;
  /** Actual attackers, retained briefly after they stop focusing this general. */
  aggro: { entity: number; expiresAtTick: number }[];
}

export type SimEvent =
  | { type: 'hit'; attacker: number; target: number; amount: number; ranged: boolean }
  | { type: 'death'; entity: number }
  | {
      type: 'special';
      side: Side;
      specialId: string;
      /** Effect art id (assets/fx/<fx>). */
      fx: string;
      /** What happened, in effect order: damage areas, 'heal', 'buff', 'debuff'. */
      areas: SpecialArea[];
      /** Caster position and unit direction toward the enemy general. */
      x: number;
      y: number;
      dirX: number;
      dirY: number;
      /** Wave half-width when areas includes 'wave', else 0. */
      width: number;
      affected: number[];
    }
  | { type: 'phase'; phase: Phase }
  | { type: 'duelBlow'; attacker: Side; amount: number };

export type SpecialArea = 'field' | 'wave' | 'random' | 'general' | 'heal' | 'buff' | 'debuff';

/** A timed side-wide modifier from a buff (own side) or debuff (enemy side) special. */
export interface ActiveEffect {
  side: Side;
  specialId: string;
  kind: 'buff' | 'debuff';
  remainingS: number;
  damageMult: number;
  speedMult: number;
  defenseMult: number;
  dotPerS: number;
}

export interface RecordedCommand {
  tick: number;
  side: Side;
  squadId: string | 'all'; // ignored for 'special'
  command: Command | Approach | 'special';
}

export interface BattleResult {
  winner: Side;
  reason: 'generalDefeated' | 'duel';
  durationS: number; // sim seconds of fight (excludes deploy and duel)
  hadDuel: boolean;
  /** Per side: troopIds that died and that survived. */
  dead: [string[], string[]];
  survivors: [string[], string[]];
}

/**
 * Struct-of-arrays entity storage. Index i is one entity (troop or general). Entities are never
 * re-indexed; dead entities keep their slot with alive[i] = 0.
 */
export interface Entities {
  count: number;
  x: Float64Array;
  y: Float64Array;
  prevX: Float64Array; // position at the start of the last step (render interpolation)
  prevY: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  hp: Float64Array;
  maxHp: Float64Array;
  cooldown: Float64Array; // attack cooldown remaining, seconds
  side: Uint8Array;
  squad: Int16Array; // index into world.squads, -1 for generals
  unit: Uint16Array; // index into data.units
  alive: Uint8Array;
  isGeneral: Uint8Array;
  target: Int32Array; // entity index or -1
  statMult: Float64Array; // stage default or per-troop override (generals: def.attack)
  troopId: string[];
  name: string[];
}

export interface World {
  // NB: world also carries private sim internals (rng state, grid, pending commands);
  // consumers must treat everything as read-only and mutate only through the sim API.
  setup: BattleSetup;
  tick: number;
  phase: Phase;
  paused: boolean;
  /** Skirmish timer: sim seconds elapsed in 'fight'. Does not advance while paused or in other phases. */
  fightTimeS: number;
  deployRemainingS: number;
  ents: Entities;
  squads: SquadState[];
  generals: [GeneralState, GeneralState];
  /** Active buffs/debuffs from specials (D24). */
  activeEffects: ActiveEffect[];
  /** Events emitted during the most recent step() only. */
  events: SimEvent[];
  commandLog: RecordedCommand[];
  result: BattleResult | null;
  /** Private sim internals (rng, grid, pending commands, caches). Opaque to consumers. */
  _internal: unknown;
}
