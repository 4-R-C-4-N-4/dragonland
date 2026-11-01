// Public sim contract. Render, UI, AI and the headless runner depend ONLY on this file and the functions
// exported from src/sim/index.ts. Pure TS: no DOM, no Pixi, no Math.random, no Date.
import type { Command, Disposition, GeneralDef, GeneralId, SpecialDef } from '../data/schemas';

export type Side = 0 | 1; // 0 = player (left, faces +x), 1 = enemy (right, faces -x)  — DECISIONS D10

// ---------- Battle setup (input) ----------

export interface TroopSetup {
  troopId: string; // roster id (player) or generated id (enemy)
  name: string;
  unitId: string;
}

export interface SquadSetup {
  id: string; // unique within the battle side
  name: string;
  disposition: Disposition;
  troops: TroopSetup[];
}

export interface SideSetup {
  generalId: GeneralId;
  formationId: string;
  squads: SquadSetup[];
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
  disposition: Disposition;
  command: Command;
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
}

export type SimEvent =
  | { type: 'hit'; attacker: number; target: number; amount: number; ranged: boolean }
  | { type: 'death'; entity: number }
  | { type: 'special'; side: Side; kind: SpecialDef['kind']; x: number; y: number; dirX: number; dirY: number; radius: number; affected: number[] }
  | { type: 'phase'; phase: Phase }
  | { type: 'duelBlow'; attacker: Side; amount: number };

export interface RecordedCommand {
  tick: number;
  side: Side;
  squadId: string | 'all'; // ignored for 'special'
  command: Command | 'special';
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
  statMult: Float64Array; // 1 or STAGE2_STAT_MULT (generals: def.attack)
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
  /** Events emitted during the most recent step() only. */
  events: SimEvent[];
  commandLog: RecordedCommand[];
  result: BattleResult | null;
}
