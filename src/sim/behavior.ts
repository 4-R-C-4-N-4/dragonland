// Disposition x command behavior (implementation.md §2.7) and per-tick troop/general AI.
import type { GameData } from '../data';
import { computeDamage } from './combat';
import { dist, normalizeTo, separationForce } from './steering';
import type { Entities, GeneralState, Side, SquadState, World } from './types';
import { internalOf, type ResolvedUnit, type WorldInternal } from './world';

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
  const dmg = computeDamage(
    data,
    { classId: aProfile.classId, line: aProfile.line, statMult: ents.statMult[attacker]! },
    { classId: tProfile.classId, line: tProfile.line },
  );
  ents.hp[target] = Math.max(0, ents.hp[target]! - dmg);
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

function retargetTroop(world: World, data: GameData, internal: WorldInternal, e: number): void {
  const ents = world.ents;
  const side = ents.side[e] as Side;
  const enemy = enemySide(side);
  const squad = world.squads[ents.squad[e]!]!;
  const beh = data.behaviors;
  const general = world.generals[side];

  let target = -1;
  if (squad.disposition === 'guard') {
    const radius = squad.command === 'advance' ? beh.guard.leashRadius : beh.guard.ringRadius;
    target = nearestAliveEntity(ents, general.startX, general.startY, enemy, radius);
  } else if (squad.disposition === 'fierce') {
    if (squad.command === 'hold') {
      target = nearestAliveEntity(ents, ents.x[e]!, ents.y[e]!, enemy, beh.fierce.holdPursuitDist);
    } else if (squad.command === 'fallBack') {
      target = nearestAliveEntity(ents, ents.x[e]!, ents.y[e]!, enemy, beh.fierce.fallBackEngageDist);
    } else {
      target = nearestAliveEntity(ents, ents.x[e]!, ents.y[e]!, enemy, Infinity);
    }
  } else {
    // mixed: engage what the group contacts, based on squad centroid
    const range = squad.command === 'fallBack' ? 0 : beh.mixed.cohesionRadius;
    target = nearestAliveEntity(ents, squad.centroidX, squad.centroidY, enemy, range);
  }
  ents.target[e] = target;
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
  const speed = squad.disposition === 'mixed' ? internal.squadMinSpeed[squad.index]! : profile.moveSpeed;

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
      [vx, vy] = normalizeTo(tx - ents.x[e]!, ty - ents.y[e]!, speed);
    } else {
      attacking = ents.cooldown[e]! <= 0;
    }
  } else {
    // No valid target: fall back to disposition default movement.
    if (squad.disposition === 'guard') {
      const d = dist(ents.x[e]!, ents.y[e]!, general.startX, general.startY);
      const leash = squad.command === 'advance' ? data.behaviors.guard.leashRadius : data.behaviors.guard.ringRadius;
      if (d > leash) [vx, vy] = normalizeTo(general.startX - ents.x[e]!, general.startY - ents.y[e]!, speed);
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
  const target = nearestAliveEntity(ents, ents.x[e]!, ents.y[e]!, enemySide(side), profile.attackRange + data.behaviors.guard.leashRadius);
  ents.target[e] = target;
  if (target >= 0) {
    const d = dist(ents.x[e]!, ents.y[e]!, ents.x[target]!, ents.y[target]!);
    if (d <= profile.attackRange) {
      if (ents.cooldown[e]! <= 0) applyAttack(world, data, internal, e, target);
      return;
    }
    const distFromStart = dist(ents.x[e]!, ents.y[e]!, general.startX, general.startY);
    if (distFromStart < data.constants.GENERAL_LEASH) {
      const [vx, vy] = normalizeTo(ents.x[target]! - ents.x[e]!, ents.y[target]! - ents.y[e]!, profile.moveSpeed * data.behaviors.generalLeashSpeedFrac);
      ents.x[e] = ents.x[e]! + vx * (1 / data.constants.SIM_HZ);
      ents.y[e] = ents.y[e]! + vy * (1 / data.constants.SIM_HZ);
    }
  }
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
    if ((world.tick + e) % retargetTicks === 0) retargetTroop(world, data, internal, e);
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

