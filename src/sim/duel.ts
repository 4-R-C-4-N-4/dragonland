// Duel resolution (implementation.md §2.10, DECISIONS D3/D11/D13).
import type { GameData } from '../data';
import { computeDamage } from './combat';
import { canFireSpecialReal, doFireSpecial } from './specials';
import { buildResult } from './skirmish';
import type { Side, World } from './types';
import { internalOf, type WorldInternal } from './world';

interface DuelTimerHolder extends WorldInternal {
  duelTimer?: number;
}

function enemySide(side: Side): Side {
  return side === 0 ? 1 : 0;
}

/** Deterministic tie-break when both generals hit 0 HP on the same blow: alternates by seed
 * parity so it doesn't silently favor one side across an ensemble of battles. DECISIONS D13. */
function tieBreakWinner(world: World): Side {
  return world.setup.seed % 2 === 0 ? 0 : 1;
}

export function runDuelTick(world: World, dt: number): void {
  const internal = internalOf(world) as DuelTimerHolder;
  const data = internal.data;
  internal.duelTimer = (internal.duelTimer ?? 0) + dt;

  if (internal.duelTimer >= data.constants.DUEL_CADENCE_S) {
    internal.duelTimer -= data.constants.DUEL_CADENCE_S;
    exchangeBlow(world, data, internal);
    internal.duelRound++;
    if (world.result) return;
    if (internal.duelRound >= data.constants.DUEL_MAX_ROUNDS) {
      finishByHpFraction(world);
    }
  }
}

function exchangeBlow(world: World, data: GameData, internal: WorldInternal): void {
  const g0 = world.generals[0];
  const g1 = world.generals[1];
  const p0 = internal.generalProfile[0];
  const p1 = internal.generalProfile[1];

  const dmg0to1 = computeDamage(data, { classId: p0.classId, line: p0.line, statMult: g0.def.attack }, { classId: p1.classId, line: p1.line });
  const dmg1to0 = computeDamage(data, { classId: p1.classId, line: p1.line, statMult: g1.def.attack }, { classId: p0.classId, line: p0.line });

  world.ents.hp[g1.entity] = Math.max(0, world.ents.hp[g1.entity]! - dmg0to1);
  world.ents.hp[g0.entity] = Math.max(0, world.ents.hp[g0.entity]! - dmg1to0);
  world.events.push({ type: 'duelBlow', attacker: 0, amount: dmg0to1 });
  world.events.push({ type: 'duelBlow', attacker: 1, amount: dmg1to0 });

  for (const side of [0, 1] as const) {
    const g = world.generals[side];
    if (canFireSpecialReal(data, g)) doFireSpecial(world, data, side);
  }

  const dead0 = world.ents.hp[g0.entity]! <= 0;
  const dead1 = world.ents.hp[g1.entity]! <= 0;
  if (dead0 || dead1) {
    world.ents.alive[g0.entity] = dead0 ? 0 : world.ents.alive[g0.entity]!;
    world.ents.alive[g1.entity] = dead1 ? 0 : world.ents.alive[g1.entity]!;
    if (dead0) world.events.push({ type: 'death', entity: g0.entity });
    if (dead1) world.events.push({ type: 'death', entity: g1.entity });
    const winner: Side = dead0 && dead1 ? tieBreakWinner(world) : dead0 ? 1 : 0;
    world.result = buildResult(world, winner, 'duel');
    world.phase = 'result';
    world.events.push({ type: 'phase', phase: 'result' });
  }
}

function finishByHpFraction(world: World): void {
  const g0 = world.generals[0];
  const g1 = world.generals[1];
  const f0 = world.ents.hp[g0.entity]! / world.ents.maxHp[g0.entity]!;
  const f1 = world.ents.hp[g1.entity]! / world.ents.maxHp[g1.entity]!;
  const winner: Side = f0 === f1 ? tieBreakWinner(world) : f0 > f1 ? 0 : 1;
  world.result = buildResult(world, winner, 'duel');
  world.phase = 'result';
  world.events.push({ type: 'phase', phase: 'result' });
}
