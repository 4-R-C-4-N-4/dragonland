// General specials (DECISIONS D2/D24): Dragon Force-style, field-wide effects defined in data.
// Damage (field / wave / random / general), heal of the whole army, and timed side-wide buffs/debuffs.
import type { GameData } from '../data';
import type { SpecialEffect } from '../data/schemas';
import { computeDamage } from './combat';
import { nextInt } from './rng';
import type { ActiveEffect, GeneralState, Side, SpecialArea, World } from './types';
import { internalOf } from './world';
import { recordGeneralAggro } from './aggro';

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

/** Strength of a multiplier scaled by power: 1.3 at power 2 -> 1.6; 0.8 at power 2 -> 0.6 (floored). */
function scaleMult(mult: number, power: number): number {
  return Math.max(0.05, 1 + (mult - 1) * power);
}

function kill(world: World, i: number): void {
  if (world.ents.hp[i]! <= 0 && world.ents.alive[i] === 1) {
    world.ents.alive[i] = 0;
    world.ents.target[i] = -1;
    world.events.push({ type: 'death', entity: i });
  }
}

/** Fires the special for `side` unconditionally (caller must have checked canFireSpecialReal). */
export function doFireSpecial(world: World, data: GameData, side: Side): void {
  const internal = internalOf(world);
  const g = world.generals[side];
  const sp = g.special;
  const ents = world.ents;
  const enemy = enemySide(side);
  const gx = ents.x[g.entity]!;
  const gy = ents.y[g.entity]!;
  const eg = world.generals[enemy].entity;
  const dx0 = ents.x[eg]! - gx;
  const dy0 = ents.y[eg]! - gy;
  const len = Math.hypot(dx0, dy0) || 1;
  const dirX = dx0 / len;
  const dirY = dy0 / len;
  const caster = internal.generalProfile[side];
  const affected = new Set<number>();
  const areas: SpecialArea[] = [];
  let waveWidth = 0;

  const enemiesAlive = (withGeneral: boolean) => {
    const out: number[] = [];
    for (let i = 0; i < ents.count; i++) {
      if (ents.alive[i] === 0 || ents.side[i] !== enemy) continue;
      if (ents.isGeneral[i] === 1 && !withGeneral) continue;
      out.push(i);
    }
    return out;
  };
  const hit = (i: number, amount: number) => {
    const t = ents.isGeneral[i] === 1 ? internal.generalProfile[enemy] : internal.unitOf[ents.unit[i]!]!;
    const dmg = computeDamage(data, { classId: caster.classId, line: caster.line, statMult: (amount * sp.power) / data.constants.BASE_DAMAGE }, t)
      * sideMods(world, enemy).defenseMult;
    ents.hp[i] = Math.max(0, ents.hp[i]! - dmg);
    recordGeneralAggro(world, g.entity, i);
    affected.add(i);
    kill(world, i);
  };

  for (const fx of sp.effects) {
    if (fx.type === 'damage') {
      areas.push(fx.area);
      let targets: number[] = [];
      if (fx.area === 'general') targets = ents.alive[eg] === 1 ? [eg] : [];
      else if (fx.area === 'field') targets = enemiesAlive(fx.includeGeneral);
      else if (fx.area === 'random') {
        const pool = enemiesAlive(fx.includeGeneral);
        for (let n = 0; n < (fx.targets ?? 1) && pool.length; n++) targets.push(pool.splice(nextInt(internal.rng, pool.length), 1)[0]!);
      } else {
        // wave: a band of half-width `width` from the caster through the enemy general to the field edge
        waveWidth = fx.width ?? 60;
        for (const i of enemiesAlive(fx.includeGeneral)) {
          const rx = ents.x[i]! - gx;
          const ry = ents.y[i]! - gy;
          const along = rx * dirX + ry * dirY;
          const perp = Math.abs(rx * dirY - ry * dirX);
          if (along >= 0 && perp <= waveWidth) targets.push(i);
        }
      }
      for (const i of targets) hit(i, fx.amount);
    } else if (fx.type === 'heal') {
      areas.push('heal');
      for (let i = 0; i < ents.count; i++) {
        if (ents.alive[i] === 0 || ents.side[i] !== side) continue;
        ents.hp[i] = Math.min(ents.maxHp[i]!, ents.hp[i]! + ents.maxHp[i]! * fx.fraction * sp.power);
        affected.add(i);
      }
    } else {
      areas.push(fx.type);
      world.activeEffects.push(activeFrom(fx, fx.type === 'buff' ? side : enemy, sp.id, sp.power));
    }
  }

  world.events.push({ type: 'special', side, specialId: sp.id, fx: sp.fx, areas, x: gx, y: gy, dirX, dirY, width: waveWidth, affected: [...affected] });
  g.mp -= sp.mpCost;
  g.meter = 0;
  g.specialCooldown = sp.cooldownS;
}

function activeFrom(fx: Extract<SpecialEffect, { type: 'buff' | 'debuff' }>, side: Side, specialId: string, power: number): ActiveEffect {
  return {
    side,
    specialId,
    kind: fx.type,
    remainingS: fx.durationS,
    damageMult: scaleMult(fx.damageMult, power),
    speedMult: scaleMult(fx.speedMult, power),
    defenseMult: fx.type === 'buff' ? scaleMult(fx.defenseMult, power) : 1,
    dotPerS: fx.type === 'debuff' ? fx.dotPerS * power : 0,
  };
}

/** Combined side-wide multipliers from every active buff/debuff on that side. */
export function sideMods(world: World, side: Side): { damageMult: number; speedMult: number; defenseMult: number; dotPerS: number } {
  const m = { damageMult: 1, speedMult: 1, defenseMult: 1, dotPerS: 0 };
  for (const a of world.activeEffects) {
    if (a.side !== side) continue;
    m.damageMult *= a.damageMult;
    m.speedMult *= a.speedMult;
    m.defenseMult *= a.defenseMult;
    m.dotPerS += a.dotPerS;
  }
  return m;
}

/** Damage over time from debuffs, then expire finished effects. Troops only (generals are spared). */
export function tickActiveEffects(world: World, dt: number): void {
  if (!world.activeEffects.length) return;
  const ents = world.ents;
  for (const side of [0, 1] as const) {
    const dot = sideMods(world, side).dotPerS;
    if (dot <= 0) continue;
    for (let i = 0; i < ents.count; i++) {
      if (ents.alive[i] === 0 || ents.side[i] !== side || ents.isGeneral[i] === 1) continue;
      ents.hp[i] = Math.max(0, ents.hp[i]! - dot * dt);
      kill(world, i);
    }
  }
  for (const a of world.activeEffects) a.remainingS -= dt;
  world.activeEffects = world.activeEffects.filter((a) => a.remainingS > 1e-9);
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
