// General specials (implementation.md §2.9, DECISIONS D2/D3/D6).
import type { GameData } from '../data';
import { dist } from './steering';
import type { GeneralState, Side, World } from './types';
import { internalOf } from './world';

function enemySide(side: Side): Side {
  return side === 0 ? 1 : 0;
}

export function canFireSpecial(world: World, side: Side): boolean {
  const internal = internalOf(world);
  return canFireSpecialReal(internal.data, world.generals[side]);
}

export function canFireSpecialReal(data: GameData, g: GeneralState): boolean {
  return g.meter >= data.constants.SPECIAL_METER_MAX && g.mp >= g.special.mpCost && g.specialCooldown <= 0;
}

function angleBetween(dx: number, dy: number, dirX: number, dirY: number): number {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  const cos = (dx * dirX + dy * dirY) / len;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Fires the special for `side` unconditionally (caller must have checked canFireSpecialReal). */
export function doFireSpecial(world: World, data: GameData, side: Side): void {
  const g = world.generals[side];
  const ents = world.ents;
  const gx = ents.x[g.entity]!;
  const gy = ents.y[g.entity]!;
  const enemyG = world.generals[enemySide(side)];
  const [dirX, dirY] = (() => {
    const dx = ents.x[enemyG.entity]! - gx;
    const dy = ents.y[enemyG.entity]! - gy;
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  })();

  const affected: number[] = [];
  const targetSide = g.special.kind === 'radiusHeal' ? side : enemySide(side);
  for (let i = 0; i < ents.count; i++) {
    if (ents.alive[i] === 0 || ents.side[i] !== targetSide) continue;
    const d = dist(gx, gy, ents.x[i]!, ents.y[i]!);
    if (d > g.special.radius) continue;
    if (g.special.kind === 'cone') {
      const angle = angleBetween(ents.x[i]! - gx, ents.y[i]! - gy, dirX, dirY);
      if (angle > (g.special.coneHalfAngleDeg ?? 180)) continue;
    }
    if (g.special.kind === 'radiusHeal') {
      ents.hp[i] = Math.min(ents.maxHp[i]!, ents.hp[i]! + g.special.amount);
    } else {
      ents.hp[i] = Math.max(0, ents.hp[i]! - g.special.amount);
      if (ents.hp[i]! <= 0 && ents.alive[i] === 1) {
        ents.alive[i] = 0;
        world.events.push({ type: 'death', entity: i });
      }
    }
    affected.push(i);
  }

  world.events.push({ type: 'special', side, kind: g.special.kind, x: gx, y: gy, dirX, dirY, radius: g.special.radius, affected });
  g.mp -= g.special.mpCost;
  g.meter = 0;
  g.specialCooldown = g.special.cooldownS;
}

export function tickSpecialCooldowns(world: World, dt: number): void {
  for (const side of [0, 1] as const) {
    const g = world.generals[side];
    if (g.specialCooldown > 0) {
      g.specialCooldown = Math.max(0, g.specialCooldown - dt);
      if (g.specialCooldown === 0) g.mp = g.maxMp;
    }
  }
}

export function chargeMetersByTime(world: World, dt: number): void {
  const internal = internalOf(world);
  const data = internal.data;
  for (const side of [0, 1] as const) {
    const g = world.generals[side];
    g.meter = Math.min(data.constants.SPECIAL_METER_MAX, g.meter + data.constants.SPECIAL_CHARGE_PER_S * dt);
  }
}
