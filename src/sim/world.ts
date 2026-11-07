// World construction (implementation.md §5, §6). Builds the Entities SoA, squads, generals,
// and the private internal state the rest of src/sim relies on.
import type { GameData, UnitDef } from '../data';
import type { Approach, Command } from '../data/schemas';
import { createRng, nextRange, type Rng } from './rng';
import { generalPosition, packAroundSlot, sideDir, slotPosition } from './formations';
import { SpatialGrid } from './spatialGrid';
import type { BattleSetup, Entities, GeneralState, Side, SquadState, World } from './types';

export interface ResolvedUnit {
  classId: UnitDef['classId'];
  line: UnitDef['line'];
  moveSpeed: number;
  attackRange: number;
  attackCooldownS: number;
  flying: boolean;
  bodyRadius: number;
  maxHp: number;
  statMult: number;
}

export function resolveUnitProfile(data: GameData, unit: UnitDef): ResolvedUnit {
  const statMult = unit.stage === 3 ? data.constants.STAGE3_STAT_MULT : unit.stage === 2 ? data.constants.STAGE2_STAT_MULT : 1;
  const maxHp = data.constants.TROOP_HP * statMult;
  return {
    classId: unit.classId,
    line: unit.line,
    moveSpeed: unit.moveSpeed,
    attackRange: unit.attackRange,
    attackCooldownS: unit.attackCooldownS,
    flying: unit.flying,
    bodyRadius: unit.bodyRadius,
    maxHp,
    statMult,
  };
}

export interface PendingCommand {
  side: Side;
  squadId: string | 'all';
  command: Command | Approach | 'special';
}

export interface WorldInternal {
  data: GameData;
  rng: Rng;
  pending: PendingCommand[];
  lastRetarget: Float64Array;
  unitOf: (ResolvedUnit | undefined)[]; // indexed by ents.unit value
  unitIdByIndex: string[];
  grid: SpatialGrid;
  neighborBuf: number[];
  squadMinSpeed: number[]; // per squad index
  generalProfile: [ResolvedUnit, ResolvedUnit];
  duelRound: number;
  /** Per-entity deploy offset from its squad slot center; Mixed squads steer to centroid + offset to hold formation. */
  formOffX: Float64Array;
  formOffY: Float64Array;
  /** Entities killed this tick; removed together at the end of the tick. */
  dying: Set<number>;
}

export function internalOf(world: World): WorldInternal {
  return world._internal as WorldInternal;
}

function makeEntities(count: number): Entities {
  return {
    count,
    x: new Float64Array(count),
    y: new Float64Array(count),
    prevX: new Float64Array(count),
    prevY: new Float64Array(count),
    vx: new Float64Array(count),
    vy: new Float64Array(count),
    hp: new Float64Array(count),
    maxHp: new Float64Array(count),
    cooldown: new Float64Array(count),
    side: new Uint8Array(count),
    squad: new Int16Array(count),
    unit: new Uint16Array(count),
    alive: new Uint8Array(count),
    isGeneral: new Uint8Array(count),
    target: new Int32Array(count).fill(-1),
    statMult: new Float64Array(count),
    troopId: new Array(count).fill(''),
    name: new Array(count).fill(''),
  };
}

export function createBattle(data: GameData, setup: BattleSetup): World {
  const rng = createRng(setup.seed);

  // unit index table: stable order = data.units array order
  const unitIndexById = new Map<string, number>();
  data.units.forEach((u, i) => unitIndexById.set(u.id, i));
  const unitOf: (ResolvedUnit | undefined)[] = data.units.map((u) => resolveUnitProfile(data, u));
  const unitIdByIndex = data.units.map((u) => u.id);

  let total = 2; // 2 generals
  for (const side of setup.sides) for (const sq of side.squads) total += sq.troops.length;

  const ents = makeEntities(total);
  const formOffX = new Float64Array(total);
  const formOffY = new Float64Array(total);
  const squads: SquadState[] = [];
  const squadMinSpeed: number[] = [];
  let cursor = 2; // indices 0,1 reserved for generals

  const generalEntityBySide: [number, number] = [0, 1];
  const generals: [GeneralState, GeneralState] = [] as unknown as [GeneralState, GeneralState];
  const generalProfile: [ResolvedUnit, ResolvedUnit] = [] as unknown as [ResolvedUnit, ResolvedUnit];

  for (let sideNum = 0; sideNum < 2; sideNum++) {
    const side = sideNum as Side;
    const sideSetup = setup.sides[side]!;
    const formation = data.formationById.get(sideSetup.formationId);
    if (!formation) throw new Error(`unknown formation ${sideSetup.formationId}`);
    // One squad per formation slot: extra squads would wrap onto occupied slots and stack.
    const squadLimit = Math.min(data.constants.MAX_SQUADS, formation.slots.length);
    if (sideSetup.squads.length > squadLimit) throw new Error(`side ${side} has ${sideSetup.squads.length} squads; at most ${squadLimit} squads fit the formation`);
    const generalDef = sideSetup.general ?? data.generalById.get(sideSetup.generalId);
    if (!generalDef) throw new Error(`unknown general ${sideSetup.generalId}`);
    if (generalDef.id !== sideSetup.generalId) throw new Error(`general override ${generalDef.id} does not match ${sideSetup.generalId}`);
    const generalUnitDef = data.unitById.get(generalDef.unitId);
    if (!generalUnitDef) throw new Error(`general ${generalDef.id} has unknown unit ${generalDef.unitId}`);

    const gp = generalPosition(data, side, formation);
    const gEntity = generalEntityBySide[side];
    const gUnitIndex = unitIndexById.get(generalUnitDef.id)!;
    ents.x[gEntity] = gp.x;
    ents.y[gEntity] = gp.y;
    ents.prevX[gEntity] = gp.x;
    ents.prevY[gEntity] = gp.y;
    ents.hp[gEntity] = generalDef.hp;
    ents.maxHp[gEntity] = generalDef.hp;
    ents.side[gEntity] = side;
    ents.squad[gEntity] = -1;
    ents.unit[gEntity] = gUnitIndex;
    ents.alive[gEntity] = 1;
    ents.isGeneral[gEntity] = 1;
    ents.statMult[gEntity] = generalDef.attack;
    ents.troopId[gEntity] = `general-${side}`;
    ents.name[gEntity] = generalDef.name;

    const gProfile: ResolvedUnit = {
      classId: generalUnitDef.classId,
      line: generalUnitDef.line,
      moveSpeed: generalUnitDef.moveSpeed,
      attackRange: generalUnitDef.attackRange,
      attackCooldownS: generalUnitDef.attackCooldownS,
      flying: generalUnitDef.flying,
      bodyRadius: generalUnitDef.bodyRadius,
      maxHp: generalDef.hp,
      statMult: generalDef.attack,
    };
    // Generals read generalProfile (behavior.profileFor); unitOf stays the species troop profile so a
    // same-species ordinary troop (e.g. a stage-3 Paladin veteran) is not given general stats.
    generalProfile[side] = gProfile;

    generals[side] = {
      side,
      entity: gEntity,
      def: generalDef,
      special: generalDef.special,
      mp: 0,
      maxMp: generalDef.mp,
      startX: gp.x,
      startY: gp.y,
      aggro: [],
    };

    sideSetup.squads.forEach((sq, slot) => {
      const squadIndex = squads.length;
      const slotPos = slotPosition(data, side, formation, slot);
      // Never pack tighter than the largest body in the squad (D17).
      let maxBody = 0;
      for (const t of sq.troops) maxBody = Math.max(maxBody, data.unitById.get(t.unitId)?.bodyRadius ?? 0);
      const spacing = Math.max(data.constants.TROOP_SPACING, 2 * maxBody + 1);
      const positions = packAroundSlot(slotPos, sq.troops.length, spacing, sideDir(side));
      const members: number[] = [];
      let minSpeed = Infinity;
      sq.troops.forEach((troop, i) => {
        const e = cursor++;
        const unitDef = data.unitById.get(troop.unitId);
        if (!unitDef) throw new Error(`unknown unit ${troop.unitId}`);
        const uIndex = unitIndexById.get(troop.unitId)!;
        const profile = unitOf[uIndex]!;
        if (troop.statMult !== undefined && !(troop.statMult > 0 && Number.isFinite(troop.statMult))) {
          throw new Error(`troop ${troop.troopId}: statMult must be a positive finite number`);
        }
        const mult = troop.statMult ?? profile.statMult;
        const pos = positions[i]!;
        formOffX[e] = pos.x - slotPos.x;
        formOffY[e] = pos.y - slotPos.y;
        // Small seeded positional jitter so different seeds produce different first-contact
        // geometry (chaos source for headless variance) without any Math.random. DECISIONS D14.
        const jitter = data.constants.TROOP_SPACING * data.constants.JITTER_FRAC;
        const jx = pos.x + nextRange(rng, -jitter, jitter);
        const jy = pos.y + nextRange(rng, -jitter, jitter);
        ents.x[e] = jx;
        ents.y[e] = jy;
        ents.prevX[e] = jx;
        ents.prevY[e] = jy;
        const maxHp = data.constants.TROOP_HP * mult;
        ents.hp[e] = maxHp;
        ents.maxHp[e] = maxHp;
        ents.side[e] = side;
        ents.squad[e] = squadIndex;
        ents.unit[e] = uIndex;
        ents.alive[e] = 1;
        ents.isGeneral[e] = 0;
        ents.statMult[e] = mult;
        ents.troopId[e] = troop.troopId;
        ents.name[e] = troop.name;
        members.push(e);
        if (profile.moveSpeed < minSpeed) minSpeed = profile.moveSpeed;
      });
      squadMinSpeed.push(minSpeed === Infinity ? 0 : minSpeed);
      squads.push({
        index: squadIndex,
        id: sq.id,
        name: sq.name,
        side,
        slot,
        disposition: sq.disposition,
        command: 'advance',
        approach: sq.disposition === 'fierce' ? (slot % 2 === 0 ? 'farFlank' : 'nearFlank') : 'direct',
        flankReady: false,
        members,
        total: members.length,
        alive: members.length,
        centroidX: slotPos.x,
        centroidY: slotPos.y,
      });
    });
  }

  const internal: WorldInternal = {
    data,
    rng,
    pending: [],
    lastRetarget: new Float64Array(total),
    unitOf,
    unitIdByIndex,
    grid: new SpatialGrid(data.constants.GRID_CELL),
    neighborBuf: [],
    squadMinSpeed,
    generalProfile,
    duelRound: 0,
    formOffX,
    formOffY,
    dying: new Set(),
  };

  const world: World = {
    setup,
    tick: 0,
    phase: 'deploy',
    paused: false,
    fightTimeS: 0,
    deployRemainingS: data.constants.DEPLOY_COUNTDOWN_S,
    ents,
    squads,
    generals,
    activeEffects: [],
    events: [],
    commandLog: [],
    result: null,
    _internal: internal,
  };

  return world;
}
