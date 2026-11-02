// Fixed-step entry point (implementation.md §5 step.ts, §6).
import { retargetAndMoveTroops, runGenerals, settleBodies } from './behavior';
import { canFireSpecialReal, chargeMetersByTime, doFireSpecial, tickActiveEffects, tickSpecialCooldowns } from './specials';
import { checkFightEnd } from './skirmish';
import { runDuelTick } from './duel';
import type { Command } from '../data/schemas';
import type { RecordedCommand, Side, World } from './types';
import { internalOf, type PendingCommand, type WorldInternal } from './world';

function applyPendingCommands(world: World): void {
  const internal = internalOf(world);
  const pending = internal.pending;
  internal.pending = [];
  for (const p of pending) {
    const rec: RecordedCommand = { tick: world.tick, side: p.side, squadId: p.squadId, command: p.command };
    world.commandLog.push(rec);
    if (p.command === 'special') {
      const data = internal.data;
      const g = world.generals[p.side];
      if (canFireSpecialReal(data, g)) doFireSpecial(world, data, p.side);
      continue;
    }
    for (const squad of world.squads) {
      if (squad.side !== p.side) continue;
      if (p.squadId === 'all' || squad.id === p.squadId) squad.command = p.command;
    }
  }
}

function snapshotPrev(world: World): void {
  const ents = world.ents;
  ents.prevX.set(ents.x);
  ents.prevY.set(ents.y);
}

export function step(world: World): void {
  if (world.paused || world.phase === 'result') return;
  const internal = internalOf(world);
  const data = internal.data;
  const dt = 1 / data.constants.SIM_HZ;

  snapshotPrev(world);
  world.events.length = 0;
  applyPendingCommands(world);
  if (world.result) {
    world.tick++;
    return;
  }

  if (world.phase === 'deploy') {
    settleBodies(world);
    world.deployRemainingS = Math.max(0, world.deployRemainingS - dt);
    if (world.deployRemainingS === 0) {
      world.phase = 'fight';
      world.events.push({ type: 'phase', phase: 'fight' });
    }
  } else if (world.phase === 'fight') {
    retargetAndMoveTroops(world, dt);
    runGenerals(world);
    tickActiveEffects(world, dt);
    chargeMetersByTime(world, dt);
    tickSpecialCooldowns(world, dt);
    world.fightTimeS += dt;
    checkFightEnd(world);
  } else if (world.phase === 'duel') {
    chargeMetersByTime(world, dt);
    tickSpecialCooldowns(world, dt);
    runDuelTick(world, dt);
  }

  world.tick++;
}

export function setPaused(world: World, paused: boolean): void {
  world.paused = paused;
}

export function issueCommand(world: World, side: Side, squadId: string | 'all', command: Command): void {
  const internal = internalOf(world) as WorldInternal;
  internal.pending.push({ side, squadId, command });
}

export function fireSpecial(world: World, side: Side): boolean {
  const internal = internalOf(world) as WorldInternal;
  const can = canFireSpecialReal(internal.data, world.generals[side]!);
  internal.pending.push({ side, squadId: 'all', command: 'special' });
  return can;
}
