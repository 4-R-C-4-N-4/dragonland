// Public world contract. UI, AI and the headless runner depend ONLY on this file
// and src/world/index.ts. Pure TS: no DOM, no Pixi, no Math.random, no Date.
import type { ClassId, GeneralId } from '../data/schemas';
import type { ProgressTroop } from '../progression';

export type FactionId = string;
export type NodeId = string;
export type DivisionId = string;
export type GeneralRecordId = string;

export type NodeKind = 'castle' | 'town' | 'village' | 'lair';
/** Drives which wild species a Search order can find. */
export type Biome = 'plains' | 'forest' | 'mountain' | 'swamp' | 'ruins' | 'settled';

export interface WorldNode {
  id: NodeId;
  kind: NodeKind;
  biome: Biome;
  name: string;
  /** Map position for presentation only; the sim uses routes, not geometry. */
  x: number;
  y: number;
  owner: FactionId | null;
  /** Troops a town/castle can supply per week. 0 for villages and lairs. */
  supplyPerWeek: number;
  /** Income per turn for the owning faction. */
  incomePerTurn: number;
  /** Max generals a castle garrison holds. 0 for non-castles. */
  garrisonCap: number;
}

/** Routes are adjacency only: one turn crosses one route, whatever its shape. */
export interface WorldRoute {
  id: string;
  from: NodeId;
  to: NodeId;
}

/** A named general: the hero, a promoted veteran, or a rival. */
export interface GeneralRecord {
  id: GeneralRecordId;
  name: string;
  /** Catalog hero/stage-3 species this general's profile comes from. */
  generalId: GeneralId;
  factionId: FactionId;
  isHero: boolean;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  /** Max troops this general may lead. */
  capacity: number;
  troops: ProgressTroop[];
  /** Set while injured; counts down one per turn. */
  injuredTurns: number;
  /** Which node this general is at. */
  nodeId: NodeId;
  /** MP carried between battles; absent (older saves) means full. */
  mp?: number;
}

export interface Division {
  id: DivisionId;
  factionId: FactionId;
  /** 1..MAX_DIVISION_GENERALS general record ids, in battle order. */
  generals: GeneralRecordId[];
  /** Troops the division counts as its own; resting refills losses up to it (see muster.ts). */
  muster?: number;
  /** Node the division occupies. Divisions are always on a node. */
  atNode: NodeId;
  /** Node it came from; a beaten or retreating division returns here. */
  previousNode: NodeId | null;
}

export interface Faction {
  id: FactionId;
  name: string;
  isPlayer: boolean;
  personality: 'aggressive' | 'defensive' | 'opportunist';
  gold: number;
  /** Captured enemy generals awaiting recruitment. */
  captives: GeneralRecordId[];
  classes: ClassId[];
}

export type WarPhase = 'orders' | 'battle' | 'admin' | 'won' | 'lost';

/** One division's action for the current turn. */
export type WorldOrder =
  | { type: 'march'; division: DivisionId; toNode: NodeId }
  | { type: 'search'; division: DivisionId }
  | { type: 'rest'; division: DivisionId }
  | { type: 'hold'; division: DivisionId };

export type BattleCause = 'contact' | 'swap' | 'assault' | 'wild';

/** A battle the world has triggered and is waiting on. */
export interface PendingBattle {
  id: string;
  cause: BattleCause;
  nodeId: NodeId;
  attacker: DivisionId;
  /** Defending division, or null for a garrison-only or wild encounter. */
  defender: DivisionId | null;
  /** Wild species for a Search encounter, else empty. */
  wild: { unitId: string; count: number }[];
  /** Skirmish ids already applied; makes result application idempotent. */
  processedSkirmishIds: string[];
}

export type WorldEvent =
  | { type: 'moved'; division: DivisionId; from: NodeId; to: NodeId }
  | { type: 'captured'; nodeId: NodeId; factionId: FactionId }
  | { type: 'battleTriggered'; battleId: string; cause: BattleCause }
  | { type: 'searchedNothing'; division: DivisionId; nodeId: NodeId }
  | { type: 'turnPassed'; turn: number }
  | { type: 'weekPassed'; week: number }
  | { type: 'healed'; general: GeneralRecordId; hp: number }
  | { type: 'resupplied'; general: GeneralRecordId; troops: number }
  | { type: 'retreated'; division: DivisionId; toNode: NodeId }
  /** A beaten general's fate; `by` is the winning faction. Captured generals can be adopted. */
  | { type: 'generalDefeated'; general: GeneralRecordId; by: FactionId; outcome: 'captured' | 'injured' | 'killed' };

/** A change made outside turn orders (orders or muster phase); recorded so replay reproduces it. */
export type WarAction =
  | { type: 'leaveGarrison'; division: DivisionId; general: GeneralRecordId }
  | { type: 'joinDivision'; division: DivisionId; general: GeneralRecordId }
  | { type: 'adopt'; faction: FactionId; captive: GeneralRecordId; division: DivisionId };

export interface RecordedWorldTurn {
  turn: number;
  orders: WorldOrder[];
  /** Actions taken since the previous turn settled, applied before these orders. */
  actions?: WarAction[];
}

export interface War {
  version: 1;
  id: string;
  seed: number;
  turn: number;
  week: number;
  phase: WarPhase;
  factions: Faction[];
  nodes: WorldNode[];
  routes: WorldRoute[];
  generals: GeneralRecord[];
  divisions: Division[];
  pendingBattle: PendingBattle | null;
  events: WorldEvent[];
  /** Every resolved turn's orders, for replay. */
  turnLog: RecordedWorldTurn[];
  /** Internal: RNG state, lookups, weekly supply budgets. Not public contract. */
  _internal: unknown;
}
