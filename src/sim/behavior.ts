// Disposition x command behavior (implementation.md §2.7) and per-tick troop/general AI.
import type { GameData } from '../data';
import type { Command } from '../data/schemas';
import { computeDamage } from './combat';
import { dist, normalizeTo, separationForce } from './steering';
import type { Entities, GeneralState, Side, SquadState, World } from './types';
import { internalOf, type ResolvedUnit, type WorldInternal } from './world';
import { sideMods } from './specials';
import { recordGeneralAggro } from './aggro';

function enemySide(side: Side): Side {
  return side === 0 ? 1 : 0;
}

function nearestAliveEntity(ents: Entities, fromX: number, fromY: number, side: Side, maxRange: number, excludeGenerals = false): number {
  let best = -1;
  let bestD = maxRange;
  for (let i = 0; i < ents.count; i++) {
    if (ents.alive[i] === 0 || ents.side[i] !== side) continue;
    if (excludeGenerals && ents.isGeneral[i] === 1) continue;
    const d = dist(fromX, fromY, ents.x[i]!, ents.y[i]!);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function profileFor(internal: WorldInternal, e: number, ents: Entities): ResolvedUnit {
  if (ents.isGeneral[e] === 1) return internal.generalProfile[ents.side[e] as Side];
  return internal.unitOf[ents.unit[e]!]!;
}

function flyingFlags(internal: WorldInternal, ents: Entities): Uint8Array {
  const flags = new Uint8Array(ents.count);
  for (let i = 0; i < ents.count; i++) if (ents.alive[i] === 1 && profileFor(internal, i, ents).flying) flags[i] = 1;
  return flags;
}

function emitHit(world: World, attacker: number, target: number, amount: number, ranged: boolean): void {
  world.events.push({ type: 'hit', attacker, target, amount, ranged });
}

function emitDeath(world: World, entity: number): void {
  world.events.push({ type: 'death', entity });
}

function applyAttack(world: World, data: GameData, internal: WorldInternal, attacker: number, target: number): void {
  const ents = world.ents;
  const aProfile = profileFor(internal, attacker, ents);
  const tProfile = profileFor(internal, target, ents);
  let dmg = computeDamage(
    data,
    { classId: aProfile.classId, line: aProfile.line, statMult: ents.statMult[attacker]! },
    { classId: tProfile.classId, line: tProfile.line },
  );
  dmg *= sideMods(world, ents.side[attacker] as Side).damageMult * sideMods(world, ents.side[target] as Side).defenseMult;
  if (ents.isGeneral[target] === 1 && ents.isGeneral[attacker] === 0 && world.squads[ents.squad[attacker]!]!.disposition === 'fierce') {
    dmg *= data.behaviors.fierce.generalDamageMult;
  }
  ents.hp[target] = Math.max(0, ents.hp[target]! - dmg);
  recordGeneralAggro(world, attacker, target);
  emitHit(world, attacker, target, dmg, aProfile.attackRange > data.constants.RANGED_THRESHOLD);
  ents.cooldown[attacker] = aProfile.attackCooldownS;
  // Own troops' hits (and the general's own hits) charge that side's general meter. D2.
  const g = world.generals[ents.side[attacker] as Side];
  g.meter = Math.min(data.constants.SPECIAL_METER_MAX, g.meter + data.constants.SPECIAL_CHARGE_PER_HIT);
  if (ents.hp[target]! <= 0 && ents.alive[target] === 1) {
    ents.alive[target] = 0;
    ents.target[target] = -1;
    emitDeath(world, target);
  }
}

/**
 * Disposition x command targeting (MVP2, DECISIONS D21). Disposition = what the squad goes after,
 * command = how far it will go:
 *  - Fierce: Advance -> the enemy general, fighting troops that block it (blockRadius).
 *  - Mixed:  enemy troops (never the general while troops remain), each troop from its own position.
 *  - Guard:  threats near its general's CURRENT position first; on Advance otherwise fights troops
 *            like Mixed; on Hold / Fall Back stays with the general.
 */
export function chooseTarget(world: World, e: number, effectiveCommand?: Command): number {
  const internal = internalOf(world);
  const ents = world.ents;
  const side = ents.side[e] as Side;
  const enemy = enemySide(side);
  const squad = world.squads[ents.squad[e]!]!;
  const command = effectiveCommand ?? squad.command;
  const beh = internal.data.behaviors;
  const x = ents.x[e]!;
  const y = ents.y[e]!;
  const near = (radius: number, troopsOnly = false) => nearestAliveEntity(ents, x, y, enemy, radius, troopsOnly);
  /** Nearest enemy troop, or the general once no enemy troops remain. */
  const troopsFirst = (radius: number) => {
    const t = near(radius, true);
    return t >= 0 ? t : near(radius);
  };

  if (squad.disposition === 'fierce') {
    if (command === 'hold') return near(beh.fierce.holdPursuitDist);
    if (command === 'fallBack') return near(beh.fierce.fallBackEngageDist);
    if (!beh.fierce.generalFocus) return near(Infinity);
    // Anything already in reach (ranged troops included) is fought; otherwise press on to the general.
    const reach = Math.max(beh.fierce.blockRadius, internal.unitOf[ents.unit[e]!]!.attackRange);
    const blocker = near(reach, true);
    if (blocker >= 0) return blocker;
    const eg = world.generals[enemy].entity;
    return ents.alive[eg] === 1 ? eg : near(Infinity);
  }

  if (squad.disposition === 'mixed') {
    const pick = beh.mixed.targetGenerals ? (r: number) => near(r) : troopsFirst;
    if (command === 'hold') return pick(beh.mixed.holdEngageDist);
    if (command === 'fallBack') return pick(beh.mixed.fallBackEngageDist);
    return pick(beh.mixed.engageRadius > 0 ? beh.mixed.engageRadius : Infinity);
  }

  // guard
  const g = world.generals[side].entity;
  const threat = nearestAliveEntity(ents, ents.x[g]!, ents.y[g]!, enemy, beh.guard.threatRadius);
  if (threat >= 0) return threat;
  if (command === 'advance' && beh.guard.advanceFights) return troopsFirst(Infinity);
  return -1;
}

function retargetTroop(world: World, e: number): void {
  world.ents.target[e] = chooseTarget(world, e);
}

function squadAnchor(world: World, squad: SquadState, general: GeneralState): { x: number; y: number } {
  const enemyGeneral = world.generals[enemySide(squad.side)];
  switch (squad.command) {
    case 'advance':
      return { x: enemyGeneral.startX, y: enemyGeneral.startY };
    case 'fallBack':
      return { x: general.startX, y: general.startY };
    default:
      return { x: squad.centroidX, y: squad.centroidY };
  }
}

function moveTroop(
  world: World,
  data: GameData,
  internal: WorldInternal,
  flying: Uint8Array,
  e: number,
  dt: number,
): void {
  const ents = world.ents;
  const side = ents.side[e] as Side;
  const squad = world.squads[ents.squad[e]!]!;
  const general = world.generals[side];
  const profile = profileFor(internal, e, ents);
  const target = ents.target[e]!;
  const ranged = profile.attackRange > data.constants.RANGED_THRESHOLD;
  const speed = sideMods(world, side).speedMult * (
    squad.disposition === 'mixed' && data.behaviors.mixed.slowestSpeed
      ? internal.squadMinSpeed[squad.index]!
      : squad.disposition === 'fierce'
        ? profile.moveSpeed * data.behaviors.fierce.speedMult
        : profile.moveSpeed);

  let vx = 0;
  let vy = 0;
  let attacking = false;

  if (target >= 0 && ents.alive[target] === 1) {
    const tx = ents.x[target]!;
    const ty = ents.y[target]!;
    const d = dist(ents.x[e]!, ents.y[e]!, tx, ty);
    const kite = ranged && (squad.command === 'hold' || squad.command === 'fallBack') && d < data.constants.KITE_RANGE_FRAC * profile.attackRange;
    if (kite) {
      [vx, vy] = normalizeTo(ents.x[e]! - tx, ents.y[e]! - ty, speed);
    } else if (d > profile.attackRange) {
      let gx = tx;
      let gy = ty;
      if (squad.command === 'advance' && squad.approach !== 'direct') {
        const route = data.behaviors.approach;
        const laneY = data.constants.FIELD_H * (squad.approach === 'farFlank' ? route.laneFraction : 1 - route.laneFraction);
        if (!squad.flankReady) {
          // First get out to the selected lane rather than cutting straight into
          // the enemy. Keep some forward progress while spreading outward.
          gx = ents.x[e]! + (tx - ents.x[e]!) * route.laneFraction;
          gy = laneY;
        } else if (Math.abs(tx - ents.x[e]!) > route.turnDistance) {
          gy = laneY; // travel along the flank, then turn in toward the role's target
        }
      }
      [vx, vy] = normalizeTo(gx - ents.x[e]!, gy - ents.y[e]!, speed);
    } else {
      attacking = ents.cooldown[e]! <= 0;
    }
  } else {
    // No valid target: fall back to disposition default movement.
    if (squad.disposition === 'guard') {
      // Nothing to fight: return to a ring around the general's current position.
      const gx = ents.x[general.entity]!;
      const gy = ents.y[general.entity]!;
      const d = dist(ents.x[e]!, ents.y[e]!, gx, gy);
      if (d > data.behaviors.guard.ringRadius) [vx, vy] = normalizeTo(gx - ents.x[e]!, gy - ents.y[e]!, speed);
    } else if (squad.command === 'hold') {
      vx = 0;
      vy = 0;
    } else {
      const anchor = squadAnchor(world, squad, general);
      [vx, vy] = normalizeTo(anchor.x - ents.x[e]!, anchor.y - ents.y[e]!, speed);
    }
  }

  if (squad.disposition === 'mixed' && squad.command !== 'hold') {
    // Hold formation: steer toward this troop's slot in the squad shape (centroid + deploy offset).
    const fx = squad.centroidX + internal.formOffX[e]! - ents.x[e]!;
    const fy = squad.centroidY + internal.formOffY[e]! - ents.y[e]!;
    const [cx, cy] = normalizeTo(fx, fy, Math.min(speed * data.behaviors.mixed.formationPull, Math.hypot(fx, fy) * data.constants.SIM_HZ));
    vx += cx;
    vy += cy;
  }

  const [sx, sy] = separationForce(ents, flying, internal.grid, internal.neighborBuf, e, data.behaviors.separationRadius, data.behaviors.separationWeight);
  vx += sx;
  vy += sy;

  const mag = Math.hypot(vx, vy);
  if (mag > speed) {
    vx = (vx / mag) * speed;
    vy = (vy / mag) * speed;
  }

  ents.vx[e] = vx;
  ents.vy[e] = vy;
  ents.x[e] = Math.min(data.constants.FIELD_W, Math.max(0, ents.x[e]! + vx * dt));
  ents.y[e] = Math.min(data.constants.FIELD_H, Math.max(0, ents.y[e]! + vy * dt));

  if (attacking && target >= 0) applyAttack(world, data, internal, e, target);
}

function runGeneral(world: World, data: GameData, internal: WorldInternal, side: Side): void {
  const ents = world.ents;
  const general = world.generals[side];
  const e = general.entity;
  if (ents.alive[e] === 0) return;
  const profile = internal.generalProfile[side];
  ents.vx[e] = 0;
  ents.vy[e] = 0;
  const memoryTicks = Math.ceil(data.behaviors.generalAggroMemoryS * data.constants.SIM_HZ);
  general.aggro = general.aggro.filter((a) => {
    if (ents.alive[a.entity] === 0 || ents.side[a.entity] === side) return false;
    // A known attacker still focusing us remains a threat, even between ranged
    // volleys or outside our ordinary acquisition radius. No home-position leash.
    if (ents.target[a.entity] === e) a.expiresAtTick = world.tick + memoryTicks;
    return a.expiresAtTick > world.tick;
  });
  // Keep the current aggressor while valid to avoid oscillating between attackers.
  let target = general.aggro.some((a) => a.entity === ents.target[e]) ? ents.target[e]! : -1;
  if (target < 0 && general.aggro.length) {
    let nearest = Infinity;
    for (const a of general.aggro) {
      const d = dist(ents.x[e]!, ents.y[e]!, ents.x[a.entity]!, ents.y[a.entity]!);
      if (d < nearest) { nearest = d; target = a.entity; }
    }
  }
  // Defend the original position, not a moving acquisition bubble that would
  // chain-pull an idle general all the way across the field.
  if (target < 0) target = nearestAliveEntity(ents, general.startX, general.startY, enemySide(side), profile.attackRange + data.behaviors.generalEngageRadius);
  ents.target[e] = target;
  let toX = general.startX, toY = general.startY;
  let stopAt = 0;
  if (target >= 0) {
    const d = dist(ents.x[e]!, ents.y[e]!, ents.x[target]!, ents.y[target]!);
    if (d <= profile.attackRange + 1e-9) {
      if (ents.cooldown[e]! <= 0) applyAttack(world, data, internal, e, target);
      return;
    }
    toX = ents.x[target]!;
    toY = ents.y[target]!;
    stopAt = profile.attackRange;
  }
  const dt = 1 / data.constants.SIM_HZ;
  const remaining = Math.max(0, dist(ents.x[e]!, ents.y[e]!, toX, toY) - stopAt);
  const speed = Math.min(profile.moveSpeed * data.behaviors.generalLeashSpeedFrac * sideMods(world, side).speedMult, remaining / dt);
  const [vx, vy] = normalizeTo(toX - ents.x[e]!, toY - ents.y[e]!, speed);
  ents.vx[e] = vx;
  ents.vy[e] = vy;
  ents.x[e] = Math.min(data.constants.FIELD_W, Math.max(0, ents.x[e]! + vx * dt));
  ents.y[e] = Math.min(data.constants.FIELD_H, Math.max(0, ents.y[e]! + vy * dt));
}

function rebuildGrid(world: World, internal: WorldInternal): void {
  const ents = world.ents;
  internal.grid.clear();
  for (let i = 0; i < ents.count; i++) if (ents.alive[i] === 1) internal.grid.insert(i, ents.x[i]!, ents.y[i]!);
}

/**
 * Hard body-overlap resolution: no two bodies in the same domain (ground/flying) may overlap.
 * Steering separation alone loses to seek forces once velocities are clamped, which let whole
 * squads collapse onto one point. Fixed ascending order keeps it deterministic. Generals are
 * immovable anchors; troops are pushed off them.
 */
function resolveOverlaps(world: World, data: GameData, internal: WorldInternal, flying: Uint8Array): void {
  const ents = world.ents;
  const buf = internal.neighborBuf;
  const iterations = data.behaviors.overlapIterations;
  for (let it = 0; it < iterations; it++) {
    rebuildGrid(world, internal);
    for (let e = 0; e < ents.count; e++) {
      if (ents.alive[e] === 0) continue;
      const re = profileFor(internal, e, ents).bodyRadius;
      internal.grid.queryNeighborhood(ents.x[e]!, ents.y[e]!, buf);
      for (const o of buf) {
        if (o <= e || ents.alive[o] === 0 || flying[o] !== flying[e]) continue;
        const minD = re + profileFor(internal, o, ents).bodyRadius;
        let dx = ents.x[o]! - ents.x[e]!;
        let dy = ents.y[o]! - ents.y[e]!;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 1e-6) {
          // Coincident: deterministic split direction from the index pair.
          const a = ((e * 7919 + o * 104729) % 360) * (Math.PI / 180);
          dx = Math.cos(a);
          dy = Math.sin(a);
          d = 1;
        } else {
          dx /= d;
          dy /= d;
        }
        const overlap = minD - Math.min(d, minD);
        const eFixed = ents.isGeneral[e] === 1;
        const oFixed = ents.isGeneral[o] === 1;
        if (eFixed && oFixed) continue;
        const shareE = eFixed ? 0 : oFixed ? 1 : 0.5;
        const shareO = 1 - shareE;
        ents.x[e] = ents.x[e]! - dx * overlap * shareE;
        ents.y[e] = ents.y[e]! - dy * overlap * shareE;
        ents.x[o] = ents.x[o]! + dx * overlap * shareO;
        ents.y[o] = ents.y[o]! + dy * overlap * shareO;
      }
    }
  }
  const W = data.constants.FIELD_W;
  const H = data.constants.FIELD_H;
  for (let e = 0; e < ents.count; e++) {
    ents.x[e] = Math.min(W, Math.max(0, ents.x[e]!));
    ents.y[e] = Math.min(H, Math.max(0, ents.y[e]!));
  }
}

/** Push apart overlapping bodies without moving anything else (used during deploy). */
export function settleBodies(world: World): void {
  const internal = internalOf(world);
  resolveOverlaps(world, internal.data, internal, flyingFlags(internal, world.ents));
}

export function retargetAndMoveTroops(world: World, dt: number): void {
  const internal = internalOf(world);
  const data = internal.data;
  const ents = world.ents;
  const flying = flyingFlags(internal, ents);
  for (const squad of world.squads) {
    if (squad.command !== 'advance' || squad.approach === 'direct') continue;
    const route = data.behaviors.approach;
    const laneY = data.constants.FIELD_H * (squad.approach === 'farFlank' ? route.laneFraction : 1 - route.laneFraction);
    if (Math.abs(squad.centroidY - laneY) <= route.arrivalRadius) squad.flankReady = true;
  }
  rebuildGrid(world, internal);
  const retargetTicks = Math.max(1, Math.round(data.constants.RETARGET_INTERVAL_S * data.constants.SIM_HZ));
  // Alternate iteration direction by tick parity so neither side gets a persistent first-mover
  // advantage in simultaneous attack resolution (determinism preserved: still a pure function of tick).
  const forward = world.tick % 2 === 0;
  const start = forward ? 2 : ents.count - 1;
  const end = forward ? ents.count : 1;
  const stride = forward ? 1 : -1;
  for (let e = start; e !== end; e += stride) {
    if (ents.alive[e] === 0) continue;
    ents.cooldown[e] = Math.max(0, ents.cooldown[e]! - dt);
    if ((world.tick + e) % retargetTicks === 0) retargetTroop(world, e);
    moveTroop(world, data, internal, flying, e, dt);
  }
  resolveOverlaps(world, data, internal, flying);
  for (let s = 0; s < world.squads.length; s++) {
    const squad = world.squads[s]!;
    let sx = 0;
    let sy = 0;
    let alive = 0;
    for (const m of squad.members) {
      if (ents.alive[m] === 0) continue;
      sx += ents.x[m]!;
      sy += ents.y[m]!;
      alive++;
    }
    squad.alive = alive;
    if (alive > 0) {
      squad.centroidX = sx / alive;
      squad.centroidY = sy / alive;
    }
  }
}

export function runGenerals(world: World): void {
  const internal = internalOf(world);
  world.ents.cooldown[0] = Math.max(0, world.ents.cooldown[0]! - 1 / internal.data.constants.SIM_HZ);
  world.ents.cooldown[1] = Math.max(0, world.ents.cooldown[1]! - 1 / internal.data.constants.SIM_HZ);
  if (world.tick % 2 === 0) {
    runGeneral(world, internal.data, internal, 0);
    runGeneral(world, internal.data, internal, 1);
  } else {
    runGeneral(world, internal.data, internal, 1);
    runGeneral(world, internal.data, internal, 0);
  }
}

